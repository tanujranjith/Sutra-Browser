using Browser.Core.Sessions;
using Browser.Core.Workspaces;
using Browser.Data.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Storage.Pickers;

namespace Browser.App;

public sealed partial class MainWindow
{
    private readonly TextBlock _workspaceIdentity = new() { FontSize = 11, MaxWidth = 130, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new(8, 0, 0, 0), Opacity = .72, Visibility = Visibility.Collapsed };

    private Button WorkspaceButton(string label, Symbol icon, Func<Task> action) => ActionButton(label, icon, async () => await RunWorkspaceUiAsync(action));
    private async Task RunWorkspaceUiAsync(Func<Task> action)
    {
        try { await action(); }
        catch (OperationCanceledException) { }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Workspace operation: {ex.GetType().Name}"); if (!_isWindowClosed) ShowStatus("The workspace operation could not finish. Refresh the workspace library and try again.", InfoBarSeverity.Warning); }
    }

    private static Symbol WorkspaceSymbol(string label) => label switch { "Research" => Symbol.Find, "Work" => Symbol.Contact, "Study" => Symbol.Read, "Travel" => Symbol.World, "Code" => Symbol.Repair, _ => Symbol.Folder };
    private BrowserSession CaptureWorkspaceSession() => new(_vm.Tabs.Where(x => !IsNativePageTab(x)).Select(x => x.ToSnapshot()).ToList(),
        _vm.SelectedTab?.Id, DateTimeOffset.UtcNow, _splitTabIds.ToList(), _tabGroups.Values.Select(x => x.ToSnapshot()).ToList(), _splitLayout);

    private async Task ShowWorkspaceLibraryAsync()
    {
        if (_isPrivate) { await NoticeAsync("Unavailable in private browsing", "Persistent workspaces are disabled in private windows."); return; }
        var search = new TextBox { PlaceholderText = "Search names and saved pages", MaxLength = 160, MinWidth = 220 };
        AutomationProperties.SetName(search, "Search workspaces");
        var filter = new ComboBox { ItemsSource = new[] { "All", "Workspaces", "Templates" }, SelectedIndex = 0, MinWidth = 145 };
        AutomationProperties.SetName(filter, "Workspace type");
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, MinHeight = 140 };
        AutomationProperties.SetName(list, "Saved workspaces");
        var preview = new StackPanel { Spacing = 10, Padding = new(20) };
        var content = new Grid { ColumnSpacing = 16, RowSpacing = 12 };
        content.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new() { Height = new(0) });
        content.Children.Add(list);
        var previewHost = new Border { Background = ResourceBrush("CardBackgroundFillColorDefaultBrush"), CornerRadius = new(14),
            Child = new ScrollViewer { Content = preview, VerticalScrollBarVisibility = ScrollBarVisibility.Auto } };
        Grid.SetColumn(previewHost, 1); content.Children.Add(previewHost);
        content.SizeChanged += (_, e) =>
        {
            var narrow = e.NewSize.Width < 700;
            content.ColumnDefinitions[1].Width = narrow ? new(0) : new(1, GridUnitType.Star);
            content.RowDefinitions[1].Height = narrow ? new(1, GridUnitType.Star) : new(0);
            Grid.SetColumn(previewHost, narrow ? 0 : 1); Grid.SetRow(previewHost, narrow ? 1 : 0);
        };
        var closed = false; var generation = 0;
        WorkspaceRecord? Selected() => (list.SelectedItem as ListViewItem)?.Tag as WorkspaceRecord;
        async Task Load()
        {
            var version = ++generation; var selectedId = Selected()?.Id;
            await Task.Delay(120, _windowLifetimeCts.Token);
            if (closed || version != generation) return;
            var workspaces = await _workspaces.ListAsync(_windowLifetimeCts.Token);
            if (closed || version != generation) return;
            list.Items.Clear();
            foreach (var workspace in workspaces)
            {
                var session = SessionSerializer.Deserialize(workspace.SessionJson);
                var query = search.Text.Trim();
                if (filter.SelectedIndex == 1 && workspace.IsTemplate || filter.SelectedIndex == 2 && !workspace.IsTemplate) continue;
                if (!workspace.Name.Contains(query, StringComparison.OrdinalIgnoreCase) && !session.Tabs.Any(x => x.Title.Contains(query, StringComparison.OrdinalIgnoreCase) || x.Url.Contains(query, StringComparison.OrdinalIgnoreCase))) continue;
                var row = new Grid { ColumnSpacing = 12 };
                row.ColumnDefinitions.Add(new() { Width = new(5) }); row.ColumnDefinitions.Add(new() { Width = new(28) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
                row.Children.Add(new Border { Background = new SolidColorBrush(ColorFromHex(WorkspacePolicy.Color(workspace.Color))), CornerRadius = new(3) });
                var symbol = new SymbolIcon(WorkspaceSymbol(workspace.Icon)) { Foreground = new SolidColorBrush(ColorFromHex(WorkspacePolicy.Color(workspace.Color))) };
                Grid.SetColumn(symbol, 1); row.Children.Add(symbol);
                var text = ManagerRow(workspace.Name, $"{session.Tabs.Count} tabs · {(workspace.IsTemplate ? "Reusable template" : "Workspace")} · {workspace.UpdatedAt.LocalDateTime:g}");
                Grid.SetColumn(text, 2); row.Children.Add(text);
                var item = new ListViewItem { Tag = workspace, Content = row }; list.Items.Add(item);
                if (workspace.Id == selectedId) list.SelectedItem = item;
            }
            if (list.SelectedItem is null && list.Items.Count > 0) list.SelectedIndex = 0;
            if (list.Items.Count == 0) { preview.Children.Clear(); preview.Children.Add(EmptyState(Microsoft.UI.Xaml.Controls.Symbol.Library, "Save your current tabs to start a workspace, or clear the search to see more.")); }
        }
        var open = WorkspaceButton("Open new window", Symbol.NewWindow, async () => { if (Selected() is { } item) await OpenWorkspaceAsync(item, false); });
        var replace = WorkspaceButton("Replace current tabs", Symbol.Switch, async () => { if (Selected() is { } item) await OpenWorkspaceAsync(item, true); });
        var edit = WorkspaceButton("Edit details", Symbol.Edit, async () => { if (Selected() is { } item) { await EditWorkspaceDetailsAsync(item); await Load(); } });
        var versions = WorkspaceButton("Version history", Symbol.Clock, async () => await ShowWorkspaceVersionsAsync(Selected()?.Id));
        var allVersions = WorkspaceButton("Recover deleted", Symbol.Undo, async () => await ShowWorkspaceVersionsAsync(null));
        var save = WorkspaceButton("Save current tabs", Symbol.Save, async () =>
        {
            var name = new TextBox { Header = "Workspace name", MaxLength = 80, MinWidth = 300 };
            var dialog = new ContentDialog { Title = "Save current tabs", Content = name, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            try
            {
                var cleanName = WorkspacePolicy.Name(name.Text);
                var previous = (await _workspaces.ListAsync()).FirstOrDefault(x => x.Name == cleanName);
                if (previous is not null && !await ConfirmAsync("Update saved workspace?", $"The previous version of {cleanName} will remain in Version history.", "Update")) return;
                await _workspaces.SaveAsync(cleanName, SessionSerializer.Serialize(CaptureWorkspaceSession()));
                await Load(); ShowStatus("Workspace saved", InfoBarSeverity.Success);
            }
            catch (ArgumentException) { ShowStatus("Enter a name and keep at least one browser tab open.", InfoBarSeverity.Warning); }
        });
        var delete = WorkspaceButton("Delete", Symbol.Delete, async () =>
        {
            if (Selected() is not { } item || !await ConfirmAsync("Delete workspace?", $"{item.Name} will remain recoverable in version history until older versions expire. Open tabs stay open.", "Delete")) return;
            await _workspaces.DeleteAsync(item.Id); await Load(); ShowStatus("Workspace deleted. Use Recover deleted to restore a copy.");
        });
        foreach (var button in new[] { open, replace, edit, delete, versions }) button.IsEnabled = false;
        list.SelectionChanged += (_, _) =>
        {
            var item = Selected(); preview.Children.Clear();
            foreach (var button in new[] { open, replace, edit, delete, versions }) button.IsEnabled = item is not null;
            if (item is null) return;
            var session = SessionSerializer.Deserialize(item.SessionJson);
            preview.Children.Add(new TextBlock { Text = item.Name, FontSize = 24, TextWrapping = TextWrapping.Wrap });
            preview.Children.Add(new TextBlock { Text = item.IsTemplate ? "Each launch creates independent tabs. The saved template stays unchanged." : "Preview your saved pages before opening a separate window.", TextWrapping = TextWrapping.Wrap, Opacity = .7 });
            if ((session.SplitTabIds?.Count ?? 0) > 1) preview.Children.Add(new TextBlock { Text = $"{session.SplitTabIds!.Count} split panes" });
            foreach (var tab in session.Tabs.Take(100)) preview.Children.Add(ManagerRow(tab.Title, tab.Url));
            if (session.Tabs.Count > 100) preview.Children.Add(new TextBlock { Text = $"And {session.Tabs.Count - 100} more tabs…" });
        };
        search.TextChanged += async (_, _) => await RunWorkspaceUiAsync(Load); filter.SelectionChanged += async (_, _) => await RunWorkspaceUiAsync(Load);
        var toolbar = new StackPanel { Spacing = 10, Children = {
            new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { search, filter, save, allVersions } },
            new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { open, replace, edit, versions, delete,
                WorkspaceButton("Export current tabs", Symbol.Upload, async () => await ExportWorkspaceSessionAsync()), WorkspaceButton("Import in new window", Symbol.Download, async () => await ImportWorkspaceSessionAsync()) } }
        } };
        await RunWorkspaceUiAsync(Load); ShowPage("Workspaces", "Organize saved tab sets, launch reusable templates, and recover earlier versions.", PageBody(toolbar, content), () => { closed = true; generation++; });
    }

    private async Task OpenWorkspaceAsync(WorkspaceRecord workspace, bool replace)
    {
        if (_isPrivate) return;
        var session = SessionSerializer.Deserialize(workspace.SessionJson);
        if (session.Tabs.Count == 0) { ShowStatus("This workspace has no valid tabs."); return; }
        session = session with { Tabs = session.Tabs.Select(x => x with { WorkspaceName = workspace.Name }).ToList() };
        if (!replace) { ((App)Application.Current).OpenSessionWindow(session, _profileName); return; }
        if (!await ConfirmAsync("Replace every tab in this window?", $"Open {workspace.Name} here? Calls, downloads, and unsaved page edits may be interrupted. Sutra will save a recovery snapshot of tab addresses; it cannot save form contents.", "Replace tabs")) return;
        await _sessionSnapshots.SaveAsync(_sessionWindowId, _profileName, CaptureWorkspaceSession(), "Before workspace switch");
        await ReplaceTabsWithSessionAsync(WorkspacePolicy.Instantiate(session)); HidePage();
        ShowStatus($"Opened {workspace.Name}", InfoBarSeverity.Success);
    }

    private async Task EditWorkspaceDetailsAsync(WorkspaceRecord workspace)
    {
        var name = new TextBox { Header = "Name", Text = workspace.Name, MaxLength = 80 };
        var color = new ComboBox { Header = "Color", ItemsSource = WorkspacePolicy.Colors, SelectedItem = WorkspacePolicy.Color(workspace.Color) };
        var icon = new ComboBox { Header = "Label", ItemsSource = WorkspacePolicy.Icons, SelectedItem = WorkspacePolicy.Icon(workspace.Icon) };
        var template = new ToggleSwitch { Header = "Use as a reusable template", IsOn = workspace.IsTemplate };
        var dialog = new ContentDialog { Title = "Workspace details", Content = new StackPanel { Spacing = 14, Children = { name, color, icon, template } }, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        try { await _workspaces.UpdateDetailsAsync(workspace.Id, name.Text, (string)color.SelectedItem, (string)icon.SelectedItem, template.IsOn); }
        catch (ArgumentException) { ShowStatus("Use a workspace name of 1–80 visible characters."); }
        catch (Microsoft.Data.Sqlite.SqliteException ex) when (ex.SqliteErrorCode == 19) { ShowStatus("A workspace already uses that name. Choose a different name."); }
    }

    private async Task ShowWorkspaceVersionsAsync(long? workspaceId)
    {
        if (_isPrivate) return;
        var versions = await _workspaces.VersionsAsync(workspaceId);
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        foreach (var version in versions) list.Items.Add(new ListViewItem { Tag = version, Content = ManagerRow(version.Name,
            $"{version.SavedAt.LocalDateTime:f} · {version.Reason} · {SessionSerializer.Deserialize(version.SessionJson).Tabs.Count} tabs") });
        var restore = WorkspaceButton("Restore a saved copy", Symbol.Undo, async () =>
        {
            if (list.SelectedItem is not ListViewItem { Tag: WorkspaceVersion version }) return;
            var name = new TextBox { Header = "Name for restored copy", Text = (version.Name.Length > 65 ? version.Name[..65] : version.Name) + " recovered", MaxLength = 80 };
            if (await new ContentDialog { Title = "Restore workspace version", Content = name, PrimaryButtonText = "Restore copy", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot }.ShowAsync() != ContentDialogResult.Primary) return;
            try { await _workspaces.RestoreCopyAsync(version.Id, name.Text); await ShowWorkspaceLibraryAsync(); ShowStatus("Workspace copy restored", InfoBarSeverity.Success); }
            catch (ArgumentException) { ShowStatus("This name or saved session is invalid."); }
            catch (InvalidOperationException) { ShowStatus("This version has expired. Open version history again."); }
            catch (Microsoft.Data.Sqlite.SqliteException ex) when (ex.SqliteErrorCode == 19) { ShowStatus("That name is already in use. Choose a different name."); }
        });
        restore.IsEnabled = false; list.SelectionChanged += (_, _) => restore.IsEnabled = list.SelectedItem is not null;
        ShowPage("Workspace history", "Up to 20 versions per workspace and 200 in this profile. Deleted workspaces remain recoverable here until retention removes older versions.",
            versions.Count == 0 ? EmptyState(Symbol.Clock, "Earlier versions appear after you update, edit, or delete a saved workspace.") : PageBody(restore, list));
    }

    private async Task ExportWorkspaceSessionAsync()
    {
        if (_isPrivate) return;
        var picker = new FileSavePicker { SuggestedFileName = $"Sutra session {DateTime.Now:yyyy-MM-dd}" };
        picker.FileTypeChoices.Add("Sutra session", [".sutra-session"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync(); if (file is null) return;
        try { await File.WriteAllTextAsync(file.Path, SessionSerializer.Serialize(CaptureWorkspaceSession())); ShowStatus("Session exported"); }
        catch (IOException) { ShowStatus("The session could not be written."); }
    }

    private async Task ImportWorkspaceSessionAsync()
    {
        if (_isPrivate) return;
        var picker = new FileOpenPicker(); foreach (var extension in new[] { ".sutra-session", ".zephyr-session", ".luma-session" }) picker.FileTypeFilter.Add(extension);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync(); if (file is null) return;
        try
        {
            if (new FileInfo(file.Path).Length > SessionSerializer.MaximumJsonCharacters * 4L) { ShowStatus("This session file is too large."); return; }
            var session = SessionSerializer.Deserialize(await File.ReadAllTextAsync(file.Path));
            if (session.Tabs.Count == 0) { ShowStatus("The session contains no valid tabs."); return; }
            ((App)Application.Current).OpenSessionWindow(session, _profileName);
        }
        catch (IOException) { ShowStatus("The session file could not be read."); }
    }
}
