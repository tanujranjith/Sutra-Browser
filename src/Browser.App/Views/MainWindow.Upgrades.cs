using Browser.Core.Branding;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Browser.Core.Bookmarks;
using Browser.Core.Search;
using Browser.Core.Sessions;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Browser.Data.Models;
using Browser.Platform.Windows.Updates;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow
{
    private static int _updateCheckStarted;
    private sealed record PaletteCommand(string Name, string Hint, Symbol Icon, Func<Task> Run);

    private void ConfigureNavigationOverlays()
    {
        _findBar.Visibility = Visibility.Collapsed;
        _findBar.HorizontalAlignment = HorizontalAlignment.Right;
        _findBar.VerticalAlignment = VerticalAlignment.Top;
        _findBar.Margin = new(12);
        _findBar.Padding = new(8);
        _findBar.CornerRadius = new(10);
        _findBar.BorderThickness = new(1);
        _findBar.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _findBar.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        Grid.SetColumn(_findBar, 1);
        Canvas.SetZIndex(_findBar, 27);
        _contentGrid.Children.Add(_findBar);

        _tabSwitcherOverlay.Visibility = Visibility.Collapsed;
        _tabSwitcherOverlay.HorizontalAlignment = HorizontalAlignment.Center;
        _tabSwitcherOverlay.VerticalAlignment = VerticalAlignment.Center;
        _tabSwitcherOverlay.Padding = new(12);
        _tabSwitcherOverlay.CornerRadius = new(12);
        _tabSwitcherOverlay.BorderThickness = new(1);
        _tabSwitcherOverlay.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _tabSwitcherOverlay.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        Grid.SetColumn(_tabSwitcherOverlay, 1);
        Canvas.SetZIndex(_tabSwitcherOverlay, 28);
        _contentGrid.Children.Add(_tabSwitcherOverlay);
    }

    private void CycleTabWithPreview(int amount)
    {
        if (_vm.Tabs.Count < 2) return;
        var index = Math.Max(0, _vm.SelectedTab is null ? 0 : _vm.Tabs.IndexOf(_vm.SelectedTab));
        index = (index + amount + _vm.Tabs.Count) % _vm.Tabs.Count;
        var next = _vm.Tabs[index];
        _ = ActivateTabAsync(next);

        var panel = new StackPanel { Spacing = 5, Width = 390 };
        panel.Children.Add(new TextBlock { Text = $"Switch tabs · {index + 1} of {_vm.Tabs.Count}", FontSize = 12, Opacity = .58, Margin = new(6, 2, 6, 5) });
        var preview = TabPreviewPolicy.Window(_vm.Tabs.Count, index);
        if (preview.Start > 0) panel.Children.Add(new TextBlock { Text = $"↑ {preview.Start} earlier tabs", FontSize = 11, Opacity = .6 });
        foreach (var tab in _vm.Tabs.Skip(preview.Start).Take(preview.Count))
        {
            var row = new Border
            {
                Padding = new(10, 8, 10, 8), CornerRadius = new(8),
                Background = tab.Id == next.Id ? ResourceBrush("AccentFillColorSecondaryBrush") : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
                Child = ManagerRow(tab.Title, tab.Url == "browser://newtab" ? "New tab" : tab.Url)
            };
            panel.Children.Add(row);
        }
        var remaining = _vm.Tabs.Count - preview.Start - preview.Count;
        if (remaining > 0) panel.Children.Add(new TextBlock { Text = $"↓ {remaining} later tabs", FontSize = 11, Opacity = .6 });
        _tabSwitcherOverlay.Child = panel;
        _tabSwitcherOverlay.Visibility = Visibility.Visible;
        // One reusable timer plus an expiry lease stored in fields: rapid Ctrl+Tab
        // presses restart the timeout without accumulating timers, every overlay
        // closes after the final press's delay, and an older expiry can never
        // hide a newer overlay.
        _tabSwitcherScheduledGeneration = _tabSwitcherLeaseTracker.Arm();
        if (_tabSwitcherTimer is null)
        {
            _tabSwitcherTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(950) };
            _tabSwitcherTimer.Tick += (_, _) =>
            {
                _tabSwitcherTimer?.Stop();
                if (_tabSwitcherLeaseTracker.ShouldDismiss(_tabSwitcherScheduledGeneration) && !_isWindowClosed)
                    _tabSwitcherOverlay.Visibility = Visibility.Collapsed;
            };
        }
        _tabSwitcherTimer.Stop();
        _tabSwitcherTimer.Start();
    }

    private bool _commandPaletteOpen;

    private async Task ShowCommandPaletteAsync()
    {
        if (_commandPaletteOpen || _isWindowClosed) return;
        _commandPaletteOpen = true;
        try
        {
        var commands = BuildPaletteCommands();
        var search = new TextBox { PlaceholderText = "Search tabs and commands…", MaxLength = 160, Width = Math.Max(240, Math.Min(560, _root.ActualWidth - 100)) };
        AutomationProperties.SetName(search, "Search tabs and commands");
        var list = new ListView { MaxHeight = 360, SelectionMode = ListViewSelectionMode.Single, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        var empty = new TextBlock { Text = "No results. Try a website, tab title, or action such as downloads.", TextWrapping = TextWrapping.Wrap, FontSize = 13, Opacity = .65, Margin = new(8, 24, 8, 24), Visibility = Visibility.Collapsed };
        ContentDialog? dialog = null;
        void Load()
        {
            list.Items.Clear();
            var query = search.Text?.Trim() ?? "";
            var tabsOnly = query.StartsWith('/');
            var commandsOnly = query.StartsWith('>');
            if (tabsOnly || commandsOnly) query = query[1..].Trim();
            var results = new List<(PaletteCommand Command, int Rank)>();
            if (!commandsOnly)
                foreach (var tab in _vm.Tabs.OrderByDescending(tab => tab.LastActivatedAt))
                {
                    var rank = TextMatchRanking.Rank(tab.Title, tab.Url, query);
                    if (rank < 0) continue;
                    var captured = tab;
                    results.Add((new PaletteCommand(tab.Title, $"Open tab · {tab.Url}", Symbol.Go, async () => await ActivateTabAsync(captured)), query.Length == 0 ? 100 : rank + 20));
                }
            if (!tabsOnly)
                foreach (var command in commands)
                {
                    if (query.Length == 0 && (command.Name == "Sutra Save" || command.Name == Browser.Core.Privacy.KillSwitchPolicy.Command)) continue;
                    var rank = TextMatchRanking.Rank(command.Name, command.Hint, query);
                    if (rank >= 0) results.Add((command, rank));
                }
            foreach (var result in results.OrderByDescending(item => item.Rank).Take(18))
            {
                var row = new Grid { ColumnSpacing = 12, Margin = new(2, 4, 2, 4) };
                row.ColumnDefinitions.Add(new() { Width = new(26) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
                row.Children.Add(new Viewbox { Width = 16, Height = 16, VerticalAlignment = VerticalAlignment.Center, Child = new SymbolIcon(result.Command.Icon) });
                var copy = ManagerRow(result.Command.Name, result.Command.Hint); Grid.SetColumn(copy, 1); row.Children.Add(copy);
                list.Items.Add(new ListViewItem { Tag = result.Command, Content = row });
            }
            if (list.Items.Count > 0) list.SelectedIndex = 0;
            empty.Visibility = list.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (dialog is not null) dialog.IsPrimaryButtonEnabled = list.Items.Count > 0;
        }
        void MoveSelection(int delta)
        {
            if (list.Items.Count == 0) return;
            var index = list.SelectedIndex < 0 ? 0 : Math.Clamp(list.SelectedIndex + delta, 0, list.Items.Count - 1);
            list.SelectedIndex = index;
            list.ScrollIntoView(list.SelectedItem);
        }
        search.TextChanged += (_, _) => Load();
        search.KeyDown += (_, e) =>
        {
            switch (e.Key)
            {
                case VirtualKey.Down: MoveSelection(1); e.Handled = true; break;
                case VirtualKey.Up: MoveSelection(-1); e.Handled = true; break;
                    // Enter keeps the dialog's primary button behavior: it runs the
                    // selected result. Escape is handled by the dialog's Cancel.
            }
        };
        var content = new StackPanel { Spacing = 12 }; content.Children.Add(search); content.Children.Add(list); content.Children.Add(empty);
        content.Children.Add(new TextBlock { Text = "↑ ↓  Choose     Enter  Open     /  Tabs     >  Commands", FontSize = 11, Opacity = .55, TextWrapping = TextWrapping.Wrap });
        dialog = new ContentDialog { Title = "What would you like to do?", Content = content, PrimaryButtonText = "Open", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = _root.XamlRoot };
        list.DoubleTapped += async (_, _) =>
        {
            if (list.SelectedItem is ListViewItem item && item.Tag is PaletteCommand selected)
            {
                // Pointer users get the same run behavior without needing Enter.
                try { dialog.Hide(); } catch { /* already closing */ }
                await selected.Run();
            }
        };
        Load(); search.Loaded += (_, _) => search.Focus(FocusState.Keyboard);
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary && list.SelectedItem is ListViewItem chosen && chosen.Tag is PaletteCommand picked) await picked.Run();
        }
        finally { _commandPaletteOpen = false; }
    }

    private List<PaletteCommand> BuildPaletteCommands() =>
    [
        new("New tab", "Ctrl+T", Symbol.Add, () => { NewTab(); return Task.CompletedTask; }),
        new("New window", "Ctrl+N", Symbol.NewWindow, () => { OpenNewWindow(); return Task.CompletedTask; }),
        new("New private window", "Ctrl+Shift+N", Symbol.ProtectedDocument, () => { OpenPrivateWindow(); return Task.CompletedTask; }),
        new("Sutra Save", "Ctrl+Alt+Z · keep a fresh tab and close the rest", Symbol.Save, SutraSaveAsync),
        new(Browser.Core.Privacy.KillSwitchPolicy.Command, "Ctrl+Alt+Shift+K · close all windows and clear history immediately", Symbol.Cancel, () => ((App)Application.Current).RunKillSwitchAsync()),
        new("Reopen closed tab", "Ctrl+Shift+T", Symbol.OpenFile, () => { ReopenClosed(); return Task.CompletedTask; }),
        new("Recently closed tabs", "Search and reopen selected tabs from this window", Symbol.Undo, ShowRecentlyClosedAsync),
        new("Search shortcuts", "Edit local aliases and preview a search address", Symbol.Find, ShowSearchAliasesAsync),
        new("Keyboard shortcuts", "Reference, customize, and check conflicts", Symbol.Keyboard, ShowKeyboardShortcutsAsync),
        new("Page zoom", "Adjust page size and reset to 100%", Symbol.ZoomIn, ShowPageZoomAsync),
        new("Reader appearance", "Text size, reading width, and theme", Symbol.Read, ShowReaderSettingsAsync),
        new("Review duplicate bookmarks", "Review exact copies in the same folder; undo available", Symbol.OutlineStar, ReviewBookmarkDuplicatesAsync),
        new("Search open tabs", "Titles and URLs", Symbol.Find, SearchTabsAsync),
        new("Organize tabs by site", "Create tab groups after approval", Symbol.Tag, () => SuggestDomainGroupsAsync(true)),
        new("Search across page text", "Awake tabs only; remains local", Symbol.Find, SearchAcrossTabsAsync),
        new("Workspaces", "Save and restore tab sets", Symbol.Library, ShowWorkspacesAsync),
        new("Library", "Search tabs, history, bookmarks, notes, and saved articles", Symbol.Library, ShowLibrarySearchAsync),
        new("Save for offline reading", "Save this article's readable text on this device", Symbol.SaveLocal, SaveOfflineArticleAsync),
        new("Offline library", "Read saved articles without a connection", Symbol.SaveLocal, ShowOfflineLibraryAsync),
        new("Session recovery", "Reopen a saved window without replacing current tabs", Symbol.Undo, ShowSessionRecoveryAsync),
        new("Reading list", "Pages saved for later", Symbol.Document, ShowReadingListAsync),
        new("Add page note", "Attach an optional quotation and note to this page", Symbol.Edit, () => { _ = ShowPageNoteDialogAsync(null); return Task.CompletedTask; }),
        new("Page notes", "Search and edit notes saved on pages", Symbol.Document, ShowNotesManagerAsync),
        new("Find in page", "Ctrl+F", Symbol.Find, () => { ShowFindBar(); return Task.CompletedTask; }),
        new("History", "Ctrl+H", Symbol.Clock, ShowHistoryAsync),
        new("Bookmarks", "Local bookmark manager", Symbol.OutlineStar, ShowBookmarksAsync),
        new("Downloads", "Ctrl+J", Symbol.Download, ShowDownloadsAsync),
        new("Browser health", "Memory, tabs, and diagnostics", Symbol.Repair, ShowPerformanceDashboardAsync),
        new("Clean up inactive tabs", "Hibernate safe inactive tabs and reclaim memory", Symbol.Clear, CleanUpTabsAsync),
        new("Web panels", "Open a frequently used website in the lazy sidebar", Symbol.DockRight, ShowWebPanelsAsync),
        new("Settings", "Sutra, appearance, privacy, and browser preferences", Symbol.Setting, ShowSettingsAsync),
        new("Toggle reader mode", "Simplify the current article", Symbol.Document, ToggleReaderModeAsync),
        new("Open clean copy", "Open the page without common tracking parameters", Symbol.OpenFile, () => { OpenCleanCopy(); return Task.CompletedTask; }),
        new("Toggle focus mode", "Hide browser chrome · Ctrl+Shift+F", Symbol.FullScreen, () => { ToggleFocusMode(); return Task.CompletedTask; }),
        new("Toggle full screen", "F11", Symbol.FullScreen, () => { ToggleFullScreen(); return Task.CompletedTask; }),
    ];

    private async Task CleanUpTabsAsync()
    {
        var candidates = _vm.Tabs.Where(tab => !IsNativePageTab(tab)).OrderBy(tab => CleanupSleepReason(tab) is not null).ThenBy(tab => tab.LastActivatedAt).ToList();
        var selected = await PreviewTabCleanupAsync("Review tab cleanup", "Sleeping tabs stay in your tab list and reload when you select them. Choose what to put to sleep; protected tabs stay awake.", candidates, "Sleep selected", CleanupSleepReason);
        var slept = 0;
        foreach (var tab in selected)
        {
            if (_isWindowClosed) return;
            if (!_vm.Tabs.Contains(tab) || CleanupSleepReason(tab) is not null) continue;
            await HibernateTabAsync(tab, quiet: true, _windowLifetimeCts.Token);
            if (tab.IsHibernated) slept++;
        }
        RefreshTabLists();
        if (selected.Count > 0) ShowStatus($"Put {slept} tabs to sleep · {selected.Count - slept} kept awake after their state changed", InfoBarSeverity.Success);
    }

    private Task ShowWorkspacesAsync() => ShowWorkspaceLibraryAsync();

    private async Task ReplaceTabsWithSessionAsync(BrowserSession session)
    {
        // Serialized restores are destructive (they close every live WebView), so
        // never let two overlap and never leave the window with zero tabs if the
        // incoming session is empty or corrupt.
        if (_isReplacingTabs) return;
        _isReplacingTabs = true;
        try
        {
            foreach (var id in _videoMiniPlayers.Keys.ToArray())
                await CloseVideoMiniPlayerAsync(id, restoreTab: false);
            CancelAllPendingTabWebViewInitializations();
            foreach (var web in _webViews.Values.ToList()) { try { DetachWebView(web); web.Close(); } catch { } }
            // Every native manager page is disappearing with the tab list: retire their lifecycle callbacks first.
            foreach (var pageClosed in _nativePageClosedHandlers.Values.ToList()) { try { pageClosed(); } catch { } }
            _nativePageClosedHandlers.Clear();
            _nativePageTabs.Clear();
            HideNativePageVisual();
            _webViews.Clear(); _activeNavigationIds.Clear(); _zoomFactors.Clear(); _readerTabs.Clear(); _splitTabIds.Clear(); _tabGroups.Clear(); _vm.Tabs.Clear();
            foreach (var snapshot in session.Groups ?? [])
            {
                if (snapshot is null) continue;
                var group = TabGroup.FromSnapshot(snapshot);
                _tabGroups[group.Id] = group;
            }
            foreach (var snapshot in session.Tabs ?? []) _vm.Add(BrowserTab.FromSnapshot(snapshot), false);
            MigrateLegacyTabGroups();
            foreach (var id in session.SplitTabIds ?? []) if (_vm.Tabs.Any(x => x.Id == id)) _splitTabIds.Add(id);
            if (_splitTabIds.Count < 2) _splitTabIds.Clear();
            _splitLayout = session.SplitLayout;
            var active = _vm.Tabs.FirstOrDefault(x => x.Id == session.ActiveTabId) ?? _vm.Tabs.FirstOrDefault();
            if (active is null)
            {
                active = new BrowserTab { Url = "browser://newtab", Title = Browser.Core.Branding.AppBrand.NewTabTitle };
                _vm.Add(active, false);
            }
            RefreshTabLists(); await ActivateTabAsync(active); await SaveSessionAsync();
        }
        finally { _isReplacingTabs = false; }
    }

    private async Task AddCurrentToReadingListAsync()
    {
        var tab = _vm.SelectedTab;
        if (tab is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) { ShowStatus("Open a web page to add it to the reading list.", InfoBarSeverity.Warning); return; }
        await _readingList.AddAsync(tab.Title, tab.Url); ShowStatus("Added to reading list", InfoBarSeverity.Success);
    }

    private async Task ShowReadingListAsync()
    {
        var search = new AutoSuggestBox { PlaceholderText = "Search reading list", MinWidth = 300 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        async Task Load()
        {
            list.Items.Clear();
            foreach (var entry in await _readingList.SearchAsync(search.Text ?? ""))
                list.Items.Add(new ListViewItem { Tag = entry, Content = ManagerRow(entry.Title, $"{(entry.IsRead ? "Read" : "Unread")}  ·  {entry.Url}") });
        }
        search.TextChanged += async (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) await Load(); };
        var add = ActionButton("Add current page", Symbol.Add, async () => { await AddCurrentToReadingListAsync(); await Load(); });
        var open = ActionButton("Open", Symbol.OpenFile, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is ReadingListRecord entry) { await _readingList.SetReadAsync(entry.Id, true); HidePage(); NewTab(entry.Url, activate: true); } });
        var state = ActionButton("Toggle read", Symbol.Accept, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is ReadingListRecord entry) { await _readingList.SetReadAsync(entry.Id, !entry.IsRead); await Load(); } });
        var delete = ActionButton("Remove", Symbol.Delete, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is ReadingListRecord entry) { await _readingList.DeleteAsync(entry.Id); await Load(); } });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(search); toolbar.Children.Add(add); toolbar.Children.Add(open); toolbar.Children.Add(state); toolbar.Children.Add(delete);
        await Load(); ShowPage("Reading list", "Save pages for later without mixing them into permanent bookmarks.", PageBody(toolbar, list));
    }

    private async Task SearchAcrossTabsAsync()
    {
        var input = new TextBox { Header = "Text to find", PlaceholderText = "Search visible text in awake tabs", MinWidth = 440 };
        var dialog = new ContentDialog { Title = "Search across open tabs", Content = input, PrimaryButtonText = "Search", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(input.Text)) return;
        var results = new List<(BrowserTab Tab, string Snippet)>();
        foreach (var tab in _vm.Tabs)
        {
            if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) continue;
            try
            {
                var textJson = await web.ExecuteScriptAsync("(document.body?.innerText||'').slice(0,500000)");
                var text = JsonSerializer.Deserialize<string>(textJson) ?? "";
                var index = text.IndexOf(input.Text, StringComparison.OrdinalIgnoreCase);
                if (index < 0) continue;
                var start = Math.Max(0, index - 70); var length = Math.Min(190, text.Length - start);
                results.Add((tab, text.Substring(start, length).Replace('\r', ' ').Replace('\n', ' ')));
            }
            catch { }
        }
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        foreach (var match in results) list.Items.Add(new ListViewItem { Tag = match.Tab, Content = ManagerRow(match.Tab.Title, match.Snippet) });
        list.DoubleTapped += async (_, _) => { if (list.SelectedItem is ListViewItem item && item.Tag is BrowserTab tab) { HidePage(); await ActivateTabAsync(tab); } };
        var open = ActionButton("Switch to tab", Symbol.Go, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is BrowserTab tab) { HidePage(); await ActivateTabAsync(tab); } });
        ShowPage("Cross-tab search", results.Count == 0 ? "No matches in awake tabs. Sleeping tabs were not woken." : $"Found matches in {results.Count} tab(s). Page text stayed on this device.", PageBody(open, list));
    }

    private Task ShowPerformanceDashboardAsync()
    {
        using var process = Process.GetCurrentProcess();
        process.Refresh();
        var cpu = SampleCpuPercent(process);
        var snapshot = Browser.Platform.Windows.Storage.SystemResourceSnapshotProvider.Capture();
        _healthHistory.Add(new(DateTimeOffset.UtcNow, process.WorkingSet64 / 1024 / 1024, _webViews.Count, _vm.Tabs.Count(x => x.IsHibernated), cpu));
        var samples = _healthHistory.Samples;
        var summary = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        summary.Children.Add(MetricCard("Browser shell memory", $"{process.WorkingSet64 / 1024d / 1024d:N0} MB"));
        summary.Children.Add(MetricCard("Shell CPU (est.)", $"{cpu:N1}%"));
        summary.Children.Add(MetricCard("Live WebViews", _webViews.Count.ToString()));
        summary.Children.Add(MetricCard("Sleeping tabs", _vm.Tabs.Count(x => x.IsHibernated).ToString()));
        summary.Children.Add(MetricCard("Memory pressure", snapshot.Pressure.ToString()));
        summary.Children.Add(MetricCard("Active downloads", _activeDownloads.Count.ToString()));
        var history = new StackPanel { Spacing = 4 };
        history.Children.Add(new TextBlock { Text = $"Memory MB over time: {Browser.Core.Diagnostics.HealthHistory.Sparkline(samples.Select(s => (double)s.ShellMemoryMb))}", FontSize = 12, Opacity = .75 });
        history.Children.Add(new TextBlock { Text = $"CPU % over time: {Browser.Core.Diagnostics.HealthHistory.Sparkline(samples.Select(s => s.CpuPercent))}", FontSize = 12, Opacity = .75 });
        history.Children.Add(new TextBlock { Text = Browser.Core.Diagnostics.AdaptiveMemoryPolicy.Describe(snapshot) + ". Renderer CPU is shared across tabs, so per-tab CPU is not reported as exact.", FontSize = 12, Opacity = .65, TextWrapping = TextWrapping.Wrap });
        if (_startupTimings.Count > 0)
            history.Children.Add(new TextBlock { Text = Browser.Core.Diagnostics.StartupPerformancePolicy.Summarize(_startupTimings), FontSize = 12, Opacity = .65, TextWrapping = TextWrapping.Wrap });
        var list = new ListView();
        foreach (var tab in _vm.Tabs.OrderByDescending(x => x.LastActivatedAt))
        {
            var reason = IsNativePageTab(tab) ? "Browser page — no WebView" : _splitTabIds.Contains(tab.Id) ? "Visible in split view" : IsInNeverHibernateGroup(tab) ? "This group stays awake" : HibernationPolicy.GetBlockReason(tab, _vm.SelectedTab,
                new(_vm.Settings.AutomaticHibernationEnabled, _vm.Settings.HibernationMinutes, _vm.Settings.NeverHibernatePinnedTabs, _vm.Settings.HibernationExclusions.ToHashSet(StringComparer.OrdinalIgnoreCase)), DateTimeOffset.UtcNow) ?? "Eligible for automatic sleep";
            var memory = tab.RendererMemoryBytes is { } bytes ? $" · Renderer {bytes / 1048576d:N0} MB{(tab.RendererMemoryIsShared ? " (shared)" : "")}" : "";
            list.Items.Add(new ListViewItem { Content = ManagerRow(tab.Title, $"{reason}{memory} · Last active {tab.LastActivatedAt.LocalDateTime:g}") });
        }
        var sleep = ActionButton("Hibernate eligible tabs", Symbol.Clock, async () => { await HibernateInactiveTabsAsync(); HidePage(); await ShowPerformanceDashboardAsync(); });
        var diagnostics = ActionButton("Copy diagnostics", Symbol.Copy, CopyDiagnostics);
        var refresh = ActionButton("Refresh measurements", Symbol.Refresh, async () => { await RefreshTabMemoryUsageAsync(); await ShowPerformanceDashboardAsync(); });
        var toolbar = new StackPanel { Spacing = 12 }; toolbar.Children.Add(summary); toolbar.Children.Add(history); var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; actions.Children.Add(sleep); actions.Children.Add(diagnostics); actions.Children.Add(refresh); toolbar.Children.Add(actions);
        ShowPage("Browser health", "Live process and tab state. Sutra does not guess per-tab memory figures it cannot measure reliably.", PageBody(toolbar, list));
        return Task.CompletedTask;
    }

    private double SampleCpuPercent(Process process)
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            var total = process.TotalProcessorTime;
            if (_lastCpuAt != DateTimeOffset.MinValue && (now - _lastCpuAt).TotalMilliseconds >= 100)
            {
                var deltaMs = (total - _lastCpuTotal).TotalMilliseconds;
                var wallMs = (now - _lastCpuAt).TotalMilliseconds * Environment.ProcessorCount;
                if (wallMs > 0) _lastCpuPercent = Math.Clamp(deltaMs / wallMs * 100, 0, 100 * Environment.ProcessorCount);
            }
            _lastCpuTotal = total;
            _lastCpuAt = now;
            return _lastCpuPercent;
        }
        catch { return 0; }
    }

    private static Border MetricCard(string label, string value)
    {
        var stack = new StackPanel { Spacing = 3 }; stack.Children.Add(new TextBlock { Text = value, FontSize = 22, FontWeight = FontWeights.SemiBold }); stack.Children.Add(new TextBlock { Text = label, FontSize = 12, Opacity = .62 });
        return new Border { Child = stack, MinWidth = 140, Padding = new(14), CornerRadius = new(9), BorderThickness = new(1), BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush") };
    }

    private void CopyDiagnostics()
    {
        using var process = Process.GetCurrentProcess();
        var text = $"Sutra {Browser.Core.Branding.AppBrand.Version}\r\nWindows {Environment.OSVersion}\r\n.NET {Environment.Version}\r\nMemory {process.WorkingSet64 / 1024d / 1024d:N0} MB\r\nCPU {_lastCpuPercent:N1}%\r\nTabs {_vm.Tabs.Count}\r\nLive WebViews {_webViews.Count}\r\nSleeping {_vm.Tabs.Count(x => x.IsHibernated)}\r\nPrivate {_isPrivate}\r\nAd blocking {_vm.Settings.AdBlockingEnabled}\r\n{Browser.Core.Diagnostics.StartupPerformancePolicy.Summarize(_startupTimings)}";
        SetClipboard(text); ShowStatus("Diagnostics copied without browsing data or secrets", InfoBarSeverity.Success);
    }

    private async Task ShowPageToolsAsync()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12, MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left };
        grid.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); grid.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var actions = new (string Title, string Detail, Symbol Icon, Func<Task> Run)[]
        {
            ("Capture visible page", "Save the current viewport as a PNG image.", Symbol.Camera, CapturePageAsync),
            ("Save as PDF", "Render the current page to a local PDF file.", Symbol.Save, SavePageAsPdfAsync),
            ("Print", "Open the native WebView2 system print dialog.", Symbol.Print, () => { PrintCurrentPage(); return Task.CompletedTask; }),
            ("Desktop shortcut", "Create a Windows shortcut that launches this page in Sutra.", Symbol.Pin, CreateDesktopShortcutAsync),
            ("Open in default browser", "Hand this page to the Windows default browser.", Symbol.OpenFile, OpenInDefaultBrowserAsync),
            ("Developer tools", "Inspect the current page in WebView2 DevTools.", Symbol.Repair, () => { CurrentWebView()?.CoreWebView2?.OpenDevToolsWindow(); return Task.CompletedTask; }),
            ("Copy clean link", "Remove common tracking parameters before copying.", Symbol.Copy, CopyCleanLinkAsync),
            ("Reader mode", "Create a focused local article view when possible.", Symbol.Document, ToggleReaderModeAsync),
            ("Add page note", "Attach an optional quotation and note to this page. Unavailable in private windows.", Symbol.Edit, () => { _ = ShowPageNoteDialogAsync(null); return Task.CompletedTask; }),
            ("Annotate selection in Sutra", "Save a quotation or PDF passage as a Sutra note linked to this source.", Symbol.Edit, AddResearchAnnotationToSutraAsync),
            ("Open page notes", "Search and edit notes saved on pages.", Symbol.Document, ShowNotesManagerAsync)
        };
        for (var i = 0; i < actions.Length; i++)
        {
            var action = actions[i];
            var button = new Button { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new(14), CornerRadius = new(10) };
            var content = new StackPanel { Spacing = 5 }; content.Children.Add(new TextBlock { Text = action.Title, FontWeight = FontWeights.SemiBold }); content.Children.Add(new TextBlock { Text = action.Detail, Opacity = .62, TextWrapping = TextWrapping.Wrap }); button.Content = content;
            button.Click += async (_, _) => { HidePage(); await action.Run(); }; Grid.SetColumn(button, i % 2); Grid.SetRow(button, i / 2); if (i % 2 == 0) grid.RowDefinitions.Add(new() { Height = GridLength.Auto }); grid.Children.Add(button);
        }
        ShowPage("Page tools", "Useful actions for the current page. Files are created only after you choose a destination.", grid);
        await Task.CompletedTask;
    }

    private async Task CapturePageAsync()
    {
        var core = CurrentWebView()?.CoreWebView2;
        if (core is null) return;
        var picker = new FileSavePicker { SuggestedStartLocation = PickerLocationId.PicturesLibrary, SuggestedFileName = SafeFileName(_vm.SelectedTab?.Title ?? "Sutra capture") };
        picker.FileTypeChoices.Add("PNG image", [".png"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync(); if (file is null) return;
        try
        {
            using var memory = new InMemoryRandomAccessStream();
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, memory);
            memory.Seek(0);
            using var source = memory.AsStreamForRead();
            await using var destination = File.Create(file.Path);
            await source.CopyToAsync(destination);
            ShowStatus("Page capture saved", InfoBarSeverity.Success);
        }
        catch { ShowStatus("The page could not be captured.", InfoBarSeverity.Error); }
    }

    private async Task SavePageAsPdfAsync()
    {
        var core = CurrentWebView()?.CoreWebView2;
        if (core is null) return;
        var picker = new FileSavePicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary, SuggestedFileName = SafeFileName(_vm.SelectedTab?.Title ?? "Sutra page") };
        picker.FileTypeChoices.Add("PDF document", [".pdf"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync(); if (file is null) return;
        try
        {
            var saved = await core.PrintToPdfAsync(file.Path, core.Environment.CreatePrintSettings());
            ShowStatus(saved ? "PDF saved" : "The PDF could not be created.", saved ? InfoBarSeverity.Success : InfoBarSeverity.Error);
        }
        catch { ShowStatus("The PDF could not be created.", InfoBarSeverity.Error); }
    }

    private void PrintCurrentPage()
    {
        try { CurrentWebView()?.CoreWebView2?.ShowPrintUI(CoreWebView2PrintDialogKind.System); }
        catch { ShowStatus("Printing is not available for this page.", InfoBarSeverity.Warning); }
    }

    private async Task CreateDesktopShortcutAsync()
    {
        var tab = _vm.SelectedTab;
        if (tab is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) { ShowStatus("Open a web page before creating a shortcut.", InfoBarSeverity.Warning); return; }
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var path = UniquePath(Path.Combine(desktop, SafeFileName(tab.Title) + ".lnk"));
            var icon = Path.Combine(AppContext.BaseDirectory, Browser.Core.Branding.AppBrand.IconRelativePath);
            var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException();
            object? shell = null; object? shortcutObject = null;
            try
            {
                shell = Activator.CreateInstance(shellType); dynamic shortcut = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, [path])!; shortcutObject = shortcut;
                shortcut.TargetPath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, AppBrand.ExecutableName);
                shortcut.Arguments = $"\"{tab.Url.Replace("\"", "")}\"";
                shortcut.WorkingDirectory = AppContext.BaseDirectory; shortcut.IconLocation = icon; shortcut.Description = $"Open {tab.Title} in Sutra"; shortcut.Save();
            }
            finally
            {
                if (shortcutObject is not null && Marshal.IsComObject(shortcutObject)) Marshal.FinalReleaseComObject(shortcutObject);
                if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
            await Task.CompletedTask;
            ShowStatus("Sutra desktop shortcut created", InfoBarSeverity.Success);
        }
        catch { ShowStatus("The desktop shortcut could not be created.", InfoBarSeverity.Error); }
    }

    private async Task OpenInDefaultBrowserAsync()
    {
        if (_vm.SelectedTab is { } tab && Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https") await Launcher.LaunchUriAsync(uri);
    }

    private static string SafeFileName(string value)
    {
        foreach (var invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
        value = value.Trim(); return value.Length == 0 ? "Sutra page" : value[..Math.Min(value.Length, 90)];
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        var directory = Path.GetDirectoryName(path)!; var name = Path.GetFileNameWithoutExtension(path); var extension = Path.GetExtension(path);
        for (var i = 2; i < 1000; i++) { var candidate = Path.Combine(directory, $"{name} ({i}){extension}"); if (!File.Exists(candidate)) return candidate; }
        return Path.Combine(directory, $"{name}-{Guid.NewGuid():N}{extension}");
    }

    private async Task ToggleUtilitySidebarAsync()
    {
        if (_workspaceSidePanelOpen) { CloseSutraSidePanel(); return; }
        if (_utilitySidebar.Visibility == Visibility.Visible)
        {
            // A visible sidebar may host a live web-panel WebView; release it
            // instead of orphaning the controller when the sidebar closes.
            if (_webPanelView is not null) CloseWebPanel();
            else
            {
                _utilitySidebar.Visibility = Visibility.Collapsed; _utilitySidebar.Child = null;
                _notesSidebarList = null; // the Notes surface is gone; drop stale refresh target
            }
            _contentGrid.ColumnDefinitions[2].Width = new(0);
            return;
        }
        _vm.IsCopilotOpen = false; _copilotPanel.Visibility = Visibility.Collapsed;
        var tabs = new TabView { IsAddTabButtonVisible = false, TabWidthMode = TabViewWidthMode.Equal, Margin = new(8) };
        tabs.TabItems.Add(new TabViewItem { Header = "Bookmarks", IsClosable = false, Content = await SidebarBookmarksAsync() });
        tabs.TabItems.Add(new TabViewItem { Header = "Reading", IsClosable = false, Content = await SidebarReadingAsync() });
        tabs.TabItems.Add(new TabViewItem { Header = "Notes", IsClosable = false, Content = await BuildSidebarNotesAsync() });
        tabs.TabItems.Add(new TabViewItem { Header = "History", IsClosable = false, Content = await SidebarHistoryAsync() });
        _utilitySidebar.Child = tabs; _utilitySidebar.Visibility = Visibility.Visible; _contentGrid.ColumnDefinitions[2].Width = new(350);
    }

    private async Task<ListView> SidebarBookmarksAsync()
    {
        var list = new ListView();
        foreach (var bookmark in (await _bookmarks.SearchAsync()).Take(100)) list.Items.Add(SidebarItem(bookmark.Title, bookmark.Url, () => Navigate(bookmark.Url)));
        return list;
    }

    private async Task<ListView> SidebarReadingAsync()
    {
        var list = new ListView();
        foreach (var entry in (await _readingList.SearchAsync()).Take(100)) list.Items.Add(SidebarItem(entry.Title, entry.IsRead ? "Read" : entry.Url, () => NewTab(entry.Url, true)));
        return list;
    }

    private async Task<ListView> SidebarHistoryAsync()
    {
        var list = new ListView();
        if (_isPrivate) return list;
        foreach (var entry in await _history.SearchAsync(limit: 100)) list.Items.Add(SidebarItem(entry.Title, entry.Domain, () => Navigate(entry.Url)));
        return list;
    }

    private static ListViewItem SidebarItem(string title, string detail, Action open)
    {
        var item = new ListViewItem { Content = ManagerRow(title, detail), HorizontalContentAlignment = HorizontalAlignment.Stretch };
        // One activation path for pointer, Enter, and Space so nothing here
        // depends on double-clicking.
        AutomationProperties.SetName(item, $"{title}. {detail}");
        ToolTipService.SetToolTip(item, detail);
        item.Tapped += (_, _) => open();
        item.KeyDown += (_, e) =>
        {
            if (e.Key is VirtualKey.Enter or VirtualKey.Space) { open(); e.Handled = true; }
        };
        return item;
    }

    private async Task ShowProfilesAsync()
    {
        var directory = App.Services.GetRequiredService<Browser.Data.Repositories.ProfileDirectoryRepository>();
        var profiles = await directory.ListAsync();
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        void Load()
        {
            list.Items.Clear();
            foreach (var profile in profiles)
                list.Items.Add(new ListViewItem { Tag = profile, Content = ManagerRow(profile, profile.Equals(_profileName, StringComparison.OrdinalIgnoreCase) ? "Current window · Separate browser library" : "Separate website sign-ins, history, bookmarks, notes, settings, and vault") });
        }
        var open = ActionButton("Open profile window", Symbol.NewWindow, () =>
        {
            if (list.SelectedItem is ListViewItem item && item.Tag is string profile) ((App)Application.Current).OpenWindow(false, null, true, profile);
        });
        var create = ActionButton("Create profile", Symbol.Add, async () =>
        {
            var name = new TextBox { Header = "Profile name", PlaceholderText = "Work", MaxLength = 40, MinWidth = 340 };
            var dialog = new ContentDialog { Title = "Create web profile", Content = name, PrimaryButtonText = "Create", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(name.Text)) return;
            try { profiles = await directory.AddAsync(name.Text); Load(); }
            catch (ArgumentException) { ShowStatus("Use letters, numbers, spaces, hyphens, or underscores.", InfoBarSeverity.Warning); }
            catch (InvalidOperationException) { ShowStatus("The profile directory is full (32 profiles).", InfoBarSeverity.Warning); }
        });
        var guest = ActionButton("Open private guest", Symbol.ProtectedDocument, () => OpenPrivateWindow());
        create.IsEnabled = !_isPrivate;
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(open); toolbar.Children.Add(create); toolbar.Children.Add(guest);
        Load();
        ShowPage("Profiles", "Each named profile has its own browser library and encrypted vault. Existing shared data remains in Default; use bookmark import/export to move a copy into another profile. Website profiles use the shared WebView2 environment.", PageBody(toolbar, list));
    }

    private void ApplyCustomKeyboardShortcuts()
    {
        foreach (var accelerator in _customAccelerators) _root.KeyboardAccelerators.Remove(accelerator);
        _customAccelerators.Clear();
        if (ShortcutConflictPolicy.Validate(_vm.Settings.CustomShortcuts).Count > 0) return;
        foreach (var (command, text) in _vm.Settings.CustomShortcuts)
        {
            if (!ShortcutDefinition.TryParse(text, out var parsed)) continue;
            var keyName = parsed.Key.Length == 1 && char.IsDigit(parsed.Key[0]) ? "Number" + parsed.Key : parsed.Key;
            if (!Enum.TryParse<Windows.System.VirtualKey>(keyName, true, out var key)) continue;
            var modifiers = Windows.System.VirtualKeyModifiers.None;
            if (parsed.Control) modifiers |= Windows.System.VirtualKeyModifiers.Control;
            if (parsed.Shift) modifiers |= Windows.System.VirtualKeyModifiers.Shift;
            if (parsed.Alt) modifiers |= Windows.System.VirtualKeyModifiers.Menu;
            var captured = command;
            var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers };
            accelerator.Invoked += (_, e) => { if (_root.IsHitTestVisible) RunCustomShortcut(captured); e.Handled = true; };
            _customAccelerators.Add(accelerator); _root.KeyboardAccelerators.Add(accelerator);
        }
    }

    private void RunCustomShortcut(string command)
    {
        switch (command)
        {
            case "CommandPalette": _ = ShowCommandPaletteAsync(); break;
            case "Workspaces": _ = ShowWorkspacesAsync(); break;
            case "Sidebar": _ = ToggleUtilitySidebarAsync(); break;
            case "Media": _ = ShowMediaHubAsync(); break;
            case "ReadingList": _ = ShowReadingListAsync(); break;
            case "PageTools": _ = ShowPageToolsAsync(); break;
            case "SutraSave": _ = SutraSaveAsync(); break;
        }
    }

    private Task ShowKeyboardShortcutsAsync()
    {
        var labels = new Dictionary<string, string>
        {
            ["CommandPalette"] = "Command palette", ["Workspaces"] = "Workspaces", ["Sidebar"] = "Sidebar",
            ["Media"] = "Media hub", ["ReadingList"] = "Reading list", ["PageTools"] = "Page tools",
            ["SutraSave"] = "Sutra Save"
        };
        var inputs = new Dictionary<string, TextBox>();
        var stack = new StackPanel { Spacing = 12, MaxWidth = 620, HorizontalAlignment = HorizontalAlignment.Left };
        var feedback = new TextBlock { TextWrapping = TextWrapping.Wrap };
        foreach (var (command, label) in labels)
        {
            var input = new TextBox { Header = label, PlaceholderText = "Example: Ctrl+Alt+M", Text = _vm.Settings.CustomShortcuts.GetValueOrDefault(command, "") };
            inputs[command] = input; stack.Children.Add(input);
            input.TextChanged += (_, _) => feedback.Text = string.Join("\n", ShortcutConflictPolicy.Validate(inputs.ToDictionary(pair => pair.Key, pair => pair.Value.Text)));
        }
        stack.Children.Add(new TextBlock { Text = "These are additional shortcuts. Standard browser shortcuts remain available. Supported keys are A-Z, 0-9, and F1-F12 with Ctrl, Shift, or Alt.", Opacity = .62, TextWrapping = TextWrapping.Wrap });
        stack.Children.Add(feedback);
        var reset = ActionButton("Reset custom shortcuts", Symbol.Refresh, () => { foreach (var input in inputs.Values) input.Text = ""; });
        stack.Children.Add(reset);
        var reference = new StackPanel { Spacing = 8 };
        foreach (var pair in ShortcutConflictPolicy.BuiltIn) reference.Children.Add(ManagerRow(pair.Value, pair.Key));
        reference.Children.Add(ManagerRow("Switch tabs / previous tab", "Ctrl+Tab / Ctrl+Shift+Tab"));
        reference.Children.Add(ManagerRow("Back / forward / fullscreen", "Alt+Left / Alt+Right / F11"));
        stack.Children.Add(new Expander { Header = "Built-in shortcut reference", Content = reference, HorizontalAlignment = HorizontalAlignment.Stretch });
        var save = new Button { Content = "Save shortcuts", CornerRadius = new(8) };
        save.Click += async (_, _) =>
        {
            var requested = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (command, input) in inputs) if (!string.IsNullOrWhiteSpace(input.Text)) requested[command] = input.Text;
            var conflicts = ShortcutConflictPolicy.Validate(requested);
            if (conflicts.Count > 0) { feedback.Text = string.Join("\n", conflicts); return; }
            var updated = SettingsValidator.Validate(_vm.Settings with { CustomShortcuts = requested });
            if (updated.CustomShortcuts.Count != requested.Count) { ShowStatus("One or more shortcuts are invalid.", InfoBarSeverity.Warning); return; }
            _vm.Settings = updated; await SaveSettingsSafeAsync(); ApplyCustomKeyboardShortcuts(); HidePage(); ShowStatus("Keyboard shortcuts saved", InfoBarSeverity.Success);
        };
        ShowPage("Keyboard shortcuts", "Add your own launch shortcuts for Sutra features.", new ScrollViewer { Content = stack }, save);
        return Task.CompletedTask;
    }

    private async Task OfferTranslationAsync(BrowserTab tab, WebView2 web)
    {
        if (_translationOfferedTabs.Contains(tab.Id) || tab.Url == "browser://newtab" || tab.Error is not null) return;
        try
        {
            var json = await web.ExecuteScriptAsync("(document.documentElement.lang||'').trim().toLowerCase()");
            if (_isWindowClosed) return;
            var language = JsonSerializer.Deserialize<string>(json) ?? "";
            if (language.Length < 2 || language.StartsWith("en", StringComparison.OrdinalIgnoreCase)) return;
            _translationOfferedTabs.Add(tab.Id);
            if (_vm.SelectedTab?.Id != tab.Id) return;
            ShowStatus($"This page appears to be in {language}. Translate it to English?", InfoBarSeverity.Informational, 9000);
            var translate = new Button { Content = "Translate", CornerRadius = new(7) };
            translate.Click += (_, _) => { TranslateCurrentPage(); _notification.ActionButton = null; _notification.IsOpen = false; };
            _notification.ActionButton = translate;
        }
        catch { }
    }

    private async Task MoveTabToNewWindowAsync(BrowserTab tab)
    {
        var check = Browser.Core.Tabs.TabTransferPolicy.CanTransfer(tab, IsNativePageTab(tab), _profileName, _isPrivate, _profileName, _isPrivate);
        if (!check.Allowed)
        {
            await NoticeAsync("Tab cannot be moved", check.Reason); return;
        }
        var target = await ((App)Application.Current).OpenPreparedWindowAsync(_isPrivate, null, false, _profileName);
        if (target is not null) await MoveTabToWindowAsync(tab, target);
    }

    private Task ShowImportDataAsync()
    {
        var panel = new StackPanel { Spacing = 14, MaxWidth = 680 };
        panel.Children.Add(new TextBlock { Text = "Import bookmarks directly from a local Chrome profile or from standard Netscape bookmark HTML exported by Chrome, Edge, Firefox, and others. Sutra does not import passwords, cookies, extensions, or browsing-session data.", TextWrapping = TextWrapping.Wrap, Opacity = .72 });
        var chrome = ActionButton("Import from Chrome", Symbol.Download, async () => await ImportChromeBookmarksAsync());
        var bookmarks = ActionButton("Import bookmark HTML", Symbol.Download, async () => await ImportBookmarksAsync(RefreshBookmarkBarAsync, RefreshBookmarkBarAsync));
        var openPasswords = ActionButton("Open password manager", Symbol.Permissions, async () => await ShowPasswordsAsync());
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; actions.Children.Add(chrome); actions.Children.Add(bookmarks); actions.Children.Add(openPasswords); panel.Children.Add(actions);
        ShowPage("Import browser data", "Bring over bookmarks without uploading them or exposing passwords.", panel);
        return Task.CompletedTask;
    }

    private async Task ImportChromeBookmarksAsync()
    {
        var chromeRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "User Data");
        var profiles = Directory.Exists(chromeRoot)
            ? Directory.EnumerateDirectories(chromeRoot)
                .Select(path => (Name: Path.GetFileName(path), Path: Path.Combine(path, "Bookmarks")))
                .Where(x => File.Exists(x.Path)).OrderBy(x => x.Name.Equals("Default", StringComparison.OrdinalIgnoreCase) ? 0 : 1).ThenBy(x => x.Name).ToList()
            : [];
        if (profiles.Count == 0)
        {
            await NoticeAsync("Chrome bookmarks were not found", "Sutra could not find a Chrome profile with a local bookmark file. Export bookmarks from Chrome as HTML and use Import bookmark HTML instead.");
            return;
        }
        var profilePicker = new ComboBox { Header = "Chrome profile", MinWidth = 280 };
        foreach (var profile in profiles) profilePicker.Items.Add(new ComboBoxItem { Content = profile.Name, Tag = profile.Path });
        profilePicker.SelectedIndex = 0;
        var confirm = new ContentDialog
        {
            Title = "Import from Chrome?",
            Content = new StackPanel { Spacing = 10, Children = { new TextBlock { Text = "Sutra will read only the local bookmark file from the profile you choose. Nothing is uploaded, changed in Chrome, or imported from passwords, cookies, history, or extensions.", TextWrapping = TextWrapping.Wrap }, profilePicker } },
            PrimaryButtonText = "Continue", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot
        };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        var source = (profilePicker.SelectedItem as ComboBoxItem)?.Tag as string;
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source)) { ShowStatus("That Chrome profile is no longer available.", InfoBarSeverity.Warning); return; }
        IReadOnlyList<ChromeBookmarkNode> bookmarkRoots;
        int bookmarkCount;
        try
        {
            var info = new FileInfo(source);
            if (info.Length > 32_000_000) throw new InvalidDataException("The Chrome bookmark file is unexpectedly large.");
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(source));
            bookmarkRoots = ChromeBookmarkImport.ParseRoots(document.RootElement);
            bookmarkCount = ChromeBookmarkImport.CountLinks(bookmarkRoots);
            if (bookmarkCount > 10_000) throw new InvalidDataException("The Chrome profile contains too many bookmarks to import at once.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            await NoticeAsync("Chrome import could not finish", "Sutra could not read Chrome's bookmark file. Close Chrome and try again, or export bookmarks from Chrome as HTML.");
            return;
        }
        if (bookmarkCount == 0) { ShowStatus("No valid Chrome bookmarks were found.", InfoBarSeverity.Warning); return; }
        var folder = new TextBox { Header = "Folder name", Text = $"Chrome import {DateTime.Now:d}", MaxLength = 60 };
        var plan = new ContentDialog
        {
            Title = $"Import {bookmarkCount} bookmark{(bookmarkCount == 1 ? "" : "s")}?",
            Content = new StackPanel { Spacing = 10, Children = { new TextBlock { Text = $"{bookmarkCount:N0} bookmark{(bookmarkCount == 1 ? "" : "s")} were found in the selected profile. Sutra will preserve Chrome's folder hierarchy and bookmark order. Nothing is uploaded and Chrome is not modified.", TextWrapping = TextWrapping.Wrap }, folder } },
            PrimaryButtonText = "Import bookmarks", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot
        };
        if (await plan.ShowAsync() != ContentDialogResult.Primary) return;
        try
        {
            var folderId = await _bookmarks.AddFolderAsync(string.IsNullOrWhiteSpace(folder.Text) ? $"Chrome import {DateTime.Now:d}" : folder.Text.Trim());
            foreach (var root in bookmarkRoots) await ImportChromeNodeAsync(root, folderId);
            await RefreshBookmarkBarAsync();
            ShowStatus($"Imported {bookmarkCount} Chrome bookmark{(bookmarkCount == 1 ? "" : "s")} with Chrome's folders", InfoBarSeverity.Success);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            await NoticeAsync("Chrome import could not finish", "Sutra could not write the imported bookmarks to its local store. Close and reopen Sutra to try again.");
        }
    }

    private async Task ImportChromeNodeAsync(ChromeBookmarkNode node, long parentFolderId)
    {
        switch (node)
        {
            case ChromeBookmarkLink link:
                await _bookmarks.AddAsync(link.Title, link.Url, parentFolderId);
                break;
            case ChromeBookmarkFolder folder:
                var folderId = await _bookmarks.AddFolderAsync(folder.Name, parentFolderId);
                foreach (var child in folder.Children) await ImportChromeNodeAsync(child, folderId);
                break;
        }
    }

    private async Task ShowUpdatesAsync()
    {
        string runtime;
        try { runtime = (await _environment.GetAsync()).BrowserVersionString; }
        catch { runtime = "Unavailable"; }
        var updateService = new BrowserUpdateService(_paths);
        BrowserUpdateCheck updateCheck;
        try { updateCheck = await updateService.CheckAsync(); }
        catch { updateCheck = new(false, "The update feed could not be checked.", null); }
        var panel = new StackPanel { Spacing = 12, MaxWidth = 680 };
        panel.Children.Add(MetricCard("Sutra version", Browser.Core.Branding.AppBrand.Version));
        panel.Children.Add(MetricCard("WebView2 Runtime", runtime));
        var status = new TextBlock { Text = updateCheck.Status, TextWrapping = TextWrapping.Wrap, Opacity = .78 };
        panel.Children.Add(status);
        panel.Children.Add(new TextBlock { Text = $"Signed releases are checked automatically. Verified updates install after you restart {AppBrand.Name}. WebView2 Evergreen is serviced separately by Microsoft.", TextWrapping = TextWrapping.Wrap, Opacity = .66 });
        Button check = null!;
        check = ActionButton("Check for updates", Symbol.Sync, async () =>
        {
            check.IsEnabled = false;
            var result = await updateService.CheckAsync();
            status.Text = result.Status;
            check.IsEnabled = true;
            if (result.IsAvailable && result.Manifest is not null)
            {
                Button stage = null!;
                stage = ActionButton($"Download {AppBrand.Name} {result.Manifest.Version}", Symbol.Download, async () =>
                {
                    stage.IsEnabled = false;
                    var staged = await updateService.DownloadAndStageAsync();
                    status.Text = staged.Status;
                    ShowStatus(staged.Status, staged.Manifest is null ? InfoBarSeverity.Warning : InfoBarSeverity.Success, 7000);
                    stage.IsEnabled = true;
                });
                panel.Children.Add(stage);
            }
        });
        panel.Children.Add(check);
        var runtimePage = ActionButton("WebView2 information", Symbol.Globe, async () => await Launcher.LaunchUriAsync(new Uri("https://developer.microsoft.com/microsoft-edge/webview2/")));
        panel.Children.Add(runtimePage);
        ShowPage("Updates", "Installed component versions and update-channel status.", panel);
    }

    private async Task CheckForUpdatesQuietlyAsync()
    {
        if (Interlocked.Exchange(ref _updateCheckStarted, 1) != 0) return;
        try
        {
            var result = await new BrowserUpdateService(_paths).DownloadAndStageAsync(_windowLifetimeCts.Token);
            if (result.Status.Contains("downloaded and will install", StringComparison.OrdinalIgnoreCase))
                DispatcherQueue.TryEnqueue(() => ShowStatus(result.Status, InfoBarSeverity.Success, 9000));
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Automatic update check failed: {ex.GetType().Name}"); }
    }
}
