using Browser.Core.Navigation;
using Browser.Core.Search;
using Browser.Core.Tabs;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow
{
    private Task ShowRecentlyClosedAsync()
    {
        var input = new TextBox { PlaceholderText = "Search recently closed tabs", MaxLength = 160 };
        AutomationProperties.SetName(input, "Search recently closed tabs");
        var list = new ListView { SelectionMode = ListViewSelectionMode.Multiple };
        var count = new TextBlock { Opacity = .65 };
        Button? reopen = null;
        void Load()
        {
            list.Items.Clear();
            foreach (var entry in _vm.RecentlyClosed.Select((snapshot, order) => (snapshot, order, rank: TextMatchRanking.Rank(snapshot.Title, snapshot.Url, input.Text))))
                if (entry.rank >= 0)
                    list.Items.Add(new ListViewItem { Tag = entry.snapshot, Content = ManagerRow(entry.snapshot.Title, entry.snapshot.Url) });
            count.Text = $"{list.Items.Count} tabs · Most recently closed first · Up to 50 kept in memory";
            if (reopen is not null) reopen.IsEnabled = false;
            if (list.Items.Count == 0) list.Items.Add(EmptyState(Symbol.Undo, "No matching closed tabs. Temporary tabs and browser screens are excluded."));
        }
        async Task OpenSelected()
        {
            var chosen = list.SelectedItems.OfType<ListViewItem>().Select(item => item.Tag).OfType<BrowserTabSnapshot>().Take(50).ToArray();
            BrowserTab? last = null;
            foreach (var snapshot in chosen)
            {
                // Remove this exact entry, preserving the order of every other entry.
                var remaining = _vm.RecentlyClosed.ToArray();
                if (!remaining.Any(item => ReferenceEquals(item, snapshot))) continue;
                _vm.RecentlyClosed.Clear();
                foreach (var item in remaining.Reverse()) if (!ReferenceEquals(item, snapshot)) _vm.RecentlyClosed.Push(item);
                var tab = BrowserTab.FromSnapshot(snapshot with { Id = Guid.NewGuid(), ParentId = null, IsHibernated = true });
                _vm.Add(tab, false); last = tab;
            }
            Load(); RefreshTabLists();
            if (last is not null) { await ActivateTabAsync(last); ShowStatus($"Reopened {chosen.Length} tabs. Background tabs stay asleep until selected.", InfoBarSeverity.Success); }
        }
        reopen = ActionButton("Reopen selected", Symbol.Undo, async () => await OpenSelected()); reopen.IsEnabled = false;
        list.SelectionChanged += (_, _) => reopen.IsEnabled = list.SelectedItems.OfType<ListViewItem>().Any(item => item.Tag is BrowserTabSnapshot);
        list.KeyDown += async (_, e) => { if (e.Key == VirtualKey.Enter) { e.Handled = true; await OpenSelected(); } };
        input.TextChanged += (_, _) => Load();
        var clear = ActionButton("Clear list", Symbol.Delete, () => { _vm.RecentlyClosed.Clear(); Load(); });
        Load();
        var toolbar = new StackPanel { Spacing = 10, Children = { input, new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { reopen, clear } }, count } };
        ShowPage("Recently closed", _isPrivate ? "Only this private window's in-memory list. Nothing here is saved to disk." : "Reopen specific tabs without restoring an entire window. Ctrl+Shift+T reopens the latest tab.", PageBody(toolbar, list));
        input.Loaded += (_, _) => input.Focus(FocusState.Keyboard);
        return Task.CompletedTask;
    }

    private Task ShowSearchAliasesAsync()
    {
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, MaxHeight = 210 };
        var aliases = new Dictionary<string, string>(_vm.Settings.SearchAliases, StringComparer.OrdinalIgnoreCase);
        var alias = new TextBox { Header = "Shortcut", PlaceholderText = "wiki", MaxLength = 24 };
        var template = new TextBox { Header = "Search address", PlaceholderText = "https://example.com/search?q={query}", MaxLength = 2048 };
        var query = new TextBox { Header = "Preview search", Text = "hello world", MaxLength = 500 };
        var preview = new TextBlock { TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true, Opacity = .75 };
        var feedback = new TextBlock { TextWrapping = TextWrapping.Wrap };
        void UpdatePreview() => preview.Text = SearchAliasPolicy.TryPreview(alias.Text, template.Text, query.Text, out var url) ? url : "Enter a shortcut and an address containing {query}. Preview stays on this device.";
        void Load()
        {
            list.Items.Clear();
            foreach (var pair in aliases.OrderBy(pair => pair.Key)) list.Items.Add(new ListViewItem { Tag = pair.Key, Content = ManagerRow(pair.Key, pair.Value) });
        }
        list.SelectionChanged += (_, _) => { if (list.SelectedItem is ListViewItem { Tag: string key }) { alias.Text = key; template.Text = aliases[key]; } };
        alias.TextChanged += (_, _) => UpdatePreview(); template.TextChanged += (_, _) => UpdatePreview(); query.TextChanged += (_, _) => UpdatePreview();
        var add = ActionButton("Add / update", Symbol.Add, () =>
        {
            if (!SearchAliasPolicy.TryValidate(alias.Text, template.Text, out var key, out var value, out var error)) { feedback.Text = error; return; }
            if (aliases.Count >= 20 && !aliases.ContainsKey(key)) { feedback.Text = "Keep up to 20 search shortcuts."; return; }
            aliases[key] = value; feedback.Text = "Shortcut staged. Choose Save changes to apply it."; Load();
        });
        var remove = ActionButton("Remove selected", Symbol.Delete, () => { if (list.SelectedItem is ListViewItem { Tag: string key }) { aliases.Remove(key); Load(); feedback.Text = "Removal staged. Choose Save changes to apply it."; } });
        var save = ActionButton("Save changes", Symbol.Save, async () => { _vm.Settings = _vm.Settings with { SearchAliases = new Dictionary<string, string>(aliases, StringComparer.OrdinalIgnoreCase) }; await SaveSettingsSafeAsync(); ShowStatus(_isPrivate ? "Search shortcuts changed for this private window" : "Search shortcuts saved", InfoBarSeverity.Success); });
        var stack = new StackPanel { Spacing = 14, MaxWidth = 720, HorizontalAlignment = HorizontalAlignment.Stretch, Children = { new TextBlock { Text = "Type a shortcut, a space, and your search in the address bar. Built-in @g, @b, and @d searches are also available.", TextWrapping = TextWrapping.Wrap }, list, alias, template, query, preview, feedback, new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { add, remove } } } };
        Load(); UpdatePreview();
        ShowPage("Search shortcuts", "Search a favorite website directly from the address bar.", new ScrollViewer { Content = stack, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }, save);
        return Task.CompletedTask;
    }

    private Task ShowPageZoomAsync()
    {
        var tab = _vm.SelectedTab;
        if (tab is null || CurrentWebView()?.CoreWebView2 is null) { ShowStatus("Open a web page to adjust its zoom."); return Task.CompletedTask; }
        var percent = new TextBlock { Text = $"{_zoomFactors.GetValueOrDefault(tab.Id, 1):P0}", FontSize = 24, HorizontalAlignment = HorizontalAlignment.Center };
        var flyout = new Flyout();
        void Change(double? delta)
        {
            if (_vm.SelectedTab?.Id != tab.Id) { flyout.Hide(); return; }
            SetZoom(delta is null ? 1 : _zoomFactors.GetValueOrDefault(tab.Id, 1) + delta.Value);
            percent.Text = $"{_zoomFactors.GetValueOrDefault(tab.Id, 1):P0}";
        }
        var minus = ActionButton("−", Symbol.ZoomOut, () => Change(-.1));
        var plus = ActionButton("+", Symbol.ZoomIn, () => Change(.1));
        AutomationProperties.SetName(minus, "Decrease page zoom"); AutomationProperties.SetName(plus, "Increase page zoom");
        flyout.Content = new StackPanel { Spacing = 12, Children = { percent, new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { minus, plus, ActionButton("Reset", Symbol.Refresh, () => Change(null)) } }, new TextBlock { Text = _isPrivate ? "Kept only in this private window." : "Remembered for this site.", Opacity = .65 } } };
        flyout.ShowAt(_address);
        return Task.CompletedTask;
    }
}
