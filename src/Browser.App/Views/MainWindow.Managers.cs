using System.Text.Json;
using Browser.Core.Bookmarks;
using Browser.Core.Navigation;
using Browser.Core.Passwords;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Browser.Data.Models;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async void OnDownloadStarting(BrowserTab tab, CoreWebView2DownloadStartingEventArgs e)
    {
        var deferral = e.GetDeferral();
        try
        {
            var file = Path.GetFileName(e.ResultFilePath);
            var destination = Path.Combine(_vm.Settings.DownloadFolder, file);
            Directory.CreateDirectory(_vm.Settings.DownloadFolder);
            if (IsPotentiallyDangerousDownload(file))
            {
                var warning = new ContentDialog
                {
                    Title = "Potentially dangerous download",
                    Content = $"{file} can run code or change this computer. Only keep it if you trust the source:\n\n{e.DownloadOperation.Uri}",
                    PrimaryButtonText = "Keep download",
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.Close,
                    XamlRoot = _root.XamlRoot
                };
                if (await warning.ShowAsync() != ContentDialogResult.Primary) { e.Cancel = true; return; }
            }
            if (File.Exists(destination))
            {
                var overwrite = new ContentDialog
                {
                    Title = "Replace existing file?",
                    Content = $"A file named “{file}” already exists.",
                    PrimaryButtonText = "Replace",
                    SecondaryButtonText = "Keep both",
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.Close,
                    XamlRoot = _root.XamlRoot
                };
                var collisionChoice = await overwrite.ShowAsync();
                if (collisionChoice == ContentDialogResult.None) { e.Cancel = true; return; }
                if (collisionChoice == ContentDialogResult.Secondary) destination = UniqueDownloadPath(destination);
            }
            e.ResultFilePath = destination;
            var id = Guid.NewGuid();
            var operation = e.DownloadOperation;
            _activeDownloads[id] = operation;
            tab.HasActiveDownload = true;
            async Task Save()
            {
                var state = operation.State.ToString();
                tab.HasActiveDownload = operation.State == CoreWebView2DownloadState.InProgress;
                if (!tab.HasActiveDownload) _activeDownloads.Remove(id);
                var error = operation.State == CoreWebView2DownloadState.Interrupted ? operation.InterruptReason.ToString() : null;
                var record = new DownloadRecord(id, file, operation.Uri, operation.ResultFilePath, DateTimeOffset.UtcNow, state, (long)operation.BytesReceived, (long?)operation.TotalBytesToReceive, error);
                if (_isPrivate) _privateDownloads[id] = record; else await _downloads.UpsertAsync(record);
                ShowDownloadShelf(record);
                if (state == "Completed") ShowStatus($"Downloaded {file}", InfoBarSeverity.Success);
                else if (state == "Interrupted") ShowStatus($"Download failed: {error}", InfoBarSeverity.Error, 7000);
                RefreshTabLists();
            }
            operation.BytesReceivedChanged += async (_, _) => await Save();
            operation.StateChanged += async (_, _) => await Save();
            await Save();
        }
        finally { deferral.Complete(); }
    }

    private static bool IsPotentiallyDangerousDownload(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        return extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".msi", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".msix", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".appx", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".bat", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".ps1", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".scr", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".com", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".js", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".vbs", StringComparison.OrdinalIgnoreCase);
    }

    private static string UniqueDownloadPath(string path)
    {
        var directory = Path.GetDirectoryName(path)!;
        var name = Path.GetFileNameWithoutExtension(path);
        var extension = Path.GetExtension(path);
        for (var number = 1; number < 10_000; number++)
        {
            var candidate = Path.Combine(directory, $"{name} ({number}){extension}");
            if (!File.Exists(candidate)) return candidate;
        }
        return Path.Combine(directory, $"{name}-{Guid.NewGuid():N}{extension}");
    }

    private void ShowDownloadShelf(DownloadRecord download)
    {
        var row = new Grid { ColumnSpacing = 10, MinWidth = 430 };
        row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var details = new StackPanel { Spacing = 4 };
        details.Children.Add(new TextBlock { Text = download.FileName, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 360 });
        var progress = new ProgressBar { Minimum = 0, Maximum = 100, Height = 3, IsIndeterminate = download.TotalBytes is not > 0 };
        if (download.TotalBytes is > 0) progress.Value = Math.Clamp(download.BytesReceived * 100d / download.TotalBytes.Value, 0, 100);
        details.Children.Add(progress);
        row.Children.Add(details);
        var manager = new Button { Content = "Downloads", CornerRadius = new(7) };
        manager.Click += async (_, _) => await ShowDownloadsAsync();
        Grid.SetColumn(manager, 1); row.Children.Add(manager);
        var close = new Button { Content = new SymbolIcon(Symbol.Cancel), CornerRadius = new(7) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(close, "Close download shelf");
        close.Click += (_, _) => _downloadShelf.Visibility = Visibility.Collapsed;
        Grid.SetColumn(close, 2); row.Children.Add(close);
        _downloadShelf.Child = row;
        _downloadShelf.Visibility = Visibility.Visible;
    }

    private async Task OnPermissionRequestedAsync(BrowserTab tab, CoreWebView2PermissionRequestedEventArgs e)
    {
        var deferral = e.GetDeferral();
        e.Handled = true;
        try
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https") { e.State = CoreWebView2PermissionState.Deny; return; }
            var origin = uri.GetLeftPart(UriPartial.Authority);
            var kind = e.PermissionKind.ToString();
            if (!_isPrivate)
            {
                var stored = await _permissions.GetAsync(origin, kind);
                if (stored == "Allow") { e.State = CoreWebView2PermissionState.Allow; return; }
                if (stored == "Deny") { e.State = CoreWebView2PermissionState.Deny; return; }
            }
            tab.HasPermissionPrompt = true;
            var dialog = new ContentDialog
            {
                Title = $"Allow {kind}?",
                Content = _isPrivate ? $"{origin} wants to use {kind.ToLowerInvariant()} in this private window. The decision applies once." : $"{origin} wants permission to use {kind.ToLowerInvariant()}.",
                PrimaryButtonText = "Allow once",
                SecondaryButtonText = _isPrivate ? null : "Always allow",
                CloseButtonText = "Block",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = _root.XamlRoot
            };
            var result = await dialog.ShowAsync();
            e.State = result is ContentDialogResult.Primary or ContentDialogResult.Secondary ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            if (!_isPrivate && result == ContentDialogResult.Secondary) await _permissions.SetAsync(new(origin, kind, "Allow", DateTimeOffset.UtcNow));
            else if (!_isPrivate && result == ContentDialogResult.None) await _permissions.SetAsync(new(origin, kind, "Deny", DateTimeOffset.UtcNow));
        }
        finally { tab.HasPermissionPrompt = false; deferral.Complete(); }
    }

    private async Task BookmarkCurrentAsync()
    {
        var tab = _vm.SelectedTab;
        if (tab is null || tab.Url == "browser://newtab") return;
        var existing = (await _bookmarks.SearchAsync()).FirstOrDefault(x => x.Url == tab.Url);
        if (existing is not null)
        {
            await _bookmarks.DeleteAsync(existing.Id);
            _bookmark.Content = new SymbolIcon(Symbol.OutlineStar);
            await RefreshBookmarkBarAsync();
            ShowStatus("Bookmark removed");
            return;
        }
        var title = new TextBox { Text = tab.Title, Header = "Title" };
        var url = new TextBox { Text = tab.Url, Header = "URL" };
        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(title); panel.Children.Add(url);
        var dialog = new ContentDialog { Title = "Add bookmark", Content = panel, PrimaryButtonText = "Save", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        await _bookmarks.AddAsync(title.Text, url.Text);
        _bookmark.Content = new SymbolIcon(Symbol.SolidStar);
        await RefreshBookmarkBarAsync();
        ShowStatus("Bookmark saved", InfoBarSeverity.Success);
    }

    private async Task ShowHistoryAsync()
    {
        var search = new AutoSuggestBox { PlaceholderText = "Search history", MinWidth = 280 };
        var range = new ComboBox { ItemsSource = new[] { "All time", "Today", "Last 7 days", "Last 30 days", "Custom dates" }, SelectedIndex = 0, MinWidth = 140 };
        var fromDate = new CalendarDatePicker { PlaceholderText = "From", MinWidth = 120, Visibility = Visibility.Collapsed };
        var toDate = new CalendarDatePicker { PlaceholderText = "To", MinWidth = 120, Visibility = Visibility.Collapsed };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        async Task Load()
        {
            var localOffset = DateTimeOffset.Now.Offset;
            DateTimeOffset? from = range.SelectedIndex switch
            {
                1 => DateTimeOffset.Now.Date,
                2 => DateTimeOffset.Now.AddDays(-7),
                3 => DateTimeOffset.Now.AddDays(-30),
                4 when fromDate.Date is { } selectedFrom => new DateTimeOffset(selectedFrom.Date, localOffset),
                _ => null
            };
            DateTimeOffset? to = range.SelectedIndex == 4 && toDate.Date is { } selectedTo
                ? new DateTimeOffset(selectedTo.Date.AddDays(1).AddTicks(-1), localOffset)
                : null;
            var entries = await _history.SearchAsync(search.Text ?? "", from, to, 500);
            list.Items.Clear();
            foreach (var entry in entries) list.Items.Add(new ListViewItem { Tag = entry, Content = ManagerRow(entry.Title, $"{entry.Domain}  ·  {entry.LastVisitedAt.LocalDateTime:g}  ·  {entry.VisitCount} visit{(entry.VisitCount == 1 ? "" : "s")}") });
        }
        search.TextChanged += async (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) await Load(); };
        range.SelectionChanged += async (_, _) => { var custom = range.SelectedIndex == 4; fromDate.Visibility = custom ? Visibility.Visible : Visibility.Collapsed; toDate.Visibility = custom ? Visibility.Visible : Visibility.Collapsed; await Load(); };
        fromDate.DateChanged += async (_, _) => { if (range.SelectedIndex == 4) await Load(); };
        toDate.DateChanged += async (_, _) => { if (range.SelectedIndex == 4) await Load(); };
        list.DoubleTapped += (_, _) => { if (list.SelectedItem is ListViewItem item && item.Tag is HistoryEntry entry) { Navigate(entry.Url); HidePage(); } };
        var open = ActionButton("Open", Symbol.OpenFile, () => { if (list.SelectedItem is ListViewItem item && item.Tag is HistoryEntry entry) { Navigate(entry.Url); HidePage(); } });
        var delete = ActionButton("Delete", Symbol.Delete, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is HistoryEntry entry) { await _history.DeleteAsync(entry.Id); await Load(); ShowUndoStatus("History entry deleted", async () => { await _history.RecordVisitAsync(entry.Url, entry.Title, entry.TypedQuery); await Load(); }); } });
        var domain = ActionButton("Delete site", Symbol.Delete, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is HistoryEntry entry) { await _history.DeleteDomainAsync(entry.Domain); await Load(); ShowStatus($"History for {entry.Domain} deleted"); } });
        var clear = new Button { Content = "Clear browsing history", CornerRadius = new(8) };
        var clearMenu = new MenuFlyout();
        AddMenu(clearMenu, "Last hour", async () => { await _history.ClearSinceAsync(DateTimeOffset.Now.AddHours(-1)); await Load(); });
        AddMenu(clearMenu, "Last day", async () => { await _history.ClearSinceAsync(DateTimeOffset.Now.AddDays(-1)); await Load(); });
        AddMenu(clearMenu, "Last week", async () => { await _history.ClearSinceAsync(DateTimeOffset.Now.AddDays(-7)); await Load(); });
        AddMenu(clearMenu, "All time", async () => { if (await ConfirmAsync("Clear all history?", "This removes all locally stored browsing and search history.", "Clear")) { await _history.ClearAllAsync(); await Load(); } });
        clear.Flyout = clearMenu;
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        toolbar.Children.Add(search); toolbar.Children.Add(range); toolbar.Children.Add(fromDate); toolbar.Children.Add(toDate); toolbar.Children.Add(open); toolbar.Children.Add(delete); toolbar.Children.Add(domain); toolbar.Children.Add(clear);
        var body = PageBody(toolbar, list);
        await Load();
        ShowPage("History", _isPrivate ? "Pages opened in this private window are not added here." : "Browsing and typed-search history stored on this device.", body);
    }

    private async Task ShowBookmarksAsync()
    {
        var search = new AutoSuggestBox { PlaceholderText = "Search bookmarks", MinWidth = 320 };
        var folderFilter = new ComboBox { Header = "Folder", MinWidth = 180 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        IReadOnlyList<BookmarkFolder> folders = [];
        string FolderLabel(BookmarkFolder folder)
        {
            var names = new List<string>();
            var current = folder;
            var seen = new HashSet<long>();
            while (seen.Add(current.Id))
            {
                names.Insert(0, current.Name);
                if (current.ParentId is not long parent) break;
                var next = folders.FirstOrDefault(candidate => candidate.Id == parent);
                if (next is null) break;
                current = next;
            }
            return string.Join(" / ", names);
        }
        async Task LoadFolders()
        {
            var selected = (folderFilter.SelectedItem as ComboBoxItem)?.Tag as long?;
            folders = await _bookmarks.ListFoldersAsync();
            folderFilter.Items.Clear();
            folderFilter.Items.Add(new ComboBoxItem { Content = "All folders" });
            foreach (var folder in folders) folderFilter.Items.Add(new ComboBoxItem { Content = FolderLabel(folder), Tag = folder.Id });
            folderFilter.SelectedItem = folderFilter.Items.OfType<ComboBoxItem>().FirstOrDefault(x => x.Tag is long id && id == selected) ?? folderFilter.Items[0];
        }
        async Task Load()
        {
            list.Items.Clear();
            var selectedFolder = (folderFilter.SelectedItem as ComboBoxItem)?.Tag as long?;
            foreach (var bookmark in (await _bookmarks.SearchAsync(search.Text ?? "")).Where(x => selectedFolder is null || x.FolderId == selectedFolder))
            {
                var folderName = folders.FirstOrDefault(x => x.Id == bookmark.FolderId) is { } bookmarkFolder ? FolderLabel(bookmarkFolder) : null;
                list.Items.Add(new ListViewItem { Tag = bookmark, Content = ManagerRow(bookmark.Title, $"{bookmark.Url}{(folderName is null ? "" : $"\nFolder: {folderName}")}") });
            }
        }
        search.TextChanged += async (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) await Load(); };
        folderFilter.SelectionChanged += async (_, _) => await Load();
        list.DoubleTapped += (_, _) => { if (list.SelectedItem is ListViewItem item && item.Tag is Bookmark bookmark) { Navigate(bookmark.Url); HidePage(); } };
        var open = ActionButton("Open", Symbol.OpenFile, () => { if (list.SelectedItem is ListViewItem item && item.Tag is Bookmark bookmark) { Navigate(bookmark.Url); HidePage(); } });
        var newTab = ActionButton("Open in new tab", Symbol.Add, () => { if (list.SelectedItem is ListViewItem item && item.Tag is Bookmark bookmark) NewTab(bookmark.Url, !_vm.Settings.OpenLinksInBackground); });
        var newWindow = ActionButton("Open in new window", Symbol.NewWindow, () => { if (list.SelectedItem is ListViewItem item && item.Tag is Bookmark bookmark) OpenNewWindow(bookmark.Url); });
        var edit = ActionButton("Edit", Symbol.Edit, async () =>
        {
            if (list.SelectedItem is not ListViewItem item || item.Tag is not Bookmark bookmark) return;
            var title = new TextBox { Header = "Title", Text = bookmark.Title }; var url = new TextBox { Header = "URL", Text = bookmark.Url };
            var folder = new ComboBox { Header = "Folder", MinWidth = 320 }; folder.Items.Add(new ComboBoxItem { Content = "No folder" }); foreach (var candidate in folders) folder.Items.Add(new ComboBoxItem { Content = FolderLabel(candidate), Tag = candidate.Id }); folder.SelectedItem = folder.Items.OfType<ComboBoxItem>().FirstOrDefault(x => x.Tag is long id && id == bookmark.FolderId) ?? folder.Items[0];
            var panel = new StackPanel { Spacing = 8 }; panel.Children.Add(title); panel.Children.Add(url); panel.Children.Add(folder);
            var dialog = new ContentDialog { Title = "Edit bookmark", Content = panel, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary) { await _bookmarks.UpdateAsync(bookmark.Id, title.Text, url.Text, (folder.SelectedItem as ComboBoxItem)?.Tag as long?, bookmark.SortOrder); await Load(); await RefreshBookmarkBarAsync(); }
        });
        var remove = ActionButton("Remove", Symbol.Delete, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is Bookmark bookmark) { await _bookmarks.DeleteAsync(bookmark.Id); await Load(); await RefreshBookmarkBarAsync(); ShowUndoStatus("Bookmark removed", async () => { await _bookmarks.AddAsync(bookmark.Title, bookmark.Url, bookmark.FolderId); await Load(); await RefreshBookmarkBarAsync(); }); } });
        var addFolder = ActionButton("New folder", Symbol.Folder, async () =>
        {
            var name = new TextBox { Header = "Folder name", MinWidth = 320, MaxLength = 80 };
            var parent = new ComboBox { Header = "Parent folder (optional)", MinWidth = 320 };
            parent.Items.Add(new ComboBoxItem { Content = "No parent" });
            foreach (var candidate in folders) parent.Items.Add(new ComboBoxItem { Content = FolderLabel(candidate), Tag = candidate.Id });
            parent.SelectedIndex = 0;
            var panel = new StackPanel { Spacing = 8 }; panel.Children.Add(name); panel.Children.Add(parent);
            var dialog = new ContentDialog { Title = "Create bookmark folder", Content = panel, PrimaryButtonText = "Create", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(name.Text)) { await _bookmarks.AddFolderAsync(name.Text, (parent.SelectedItem as ComboBoxItem)?.Tag as long?); await LoadFolders(); await Load(); }
        });
        var manageFolders = ActionButton("Manage folders", Symbol.Folder, async () =>
        {
            var folderList = new ListView { SelectionMode = ListViewSelectionMode.Single, MinHeight = 250 };
            void ReloadFolderList()
            {
                folderList.Items.Clear();
                foreach (var candidate in folders)
                    folderList.Items.Add(new ListViewItem { Tag = candidate, Content = ManagerRow(FolderLabel(candidate), candidate.ParentId is null ? "Top-level folder" : "Nested folder") });
            }
            ReloadFolderList();
            var rename = new Button { Content = "Rename", IsEnabled = false };
            var delete = new Button { Content = "Delete folder", IsEnabled = false };
            folderList.SelectionChanged += (_, _) => { var hasSelection = folderList.SelectedItem is ListViewItem; rename.IsEnabled = hasSelection; delete.IsEnabled = hasSelection; };
            rename.Click += async (_, _) =>
            {
                if (folderList.SelectedItem is not ListViewItem item || item.Tag is not BookmarkFolder selected) return;
                var name = new TextBox { Header = "Folder name", Text = selected.Name, MaxLength = 80 };
                var dialog = new ContentDialog { Title = "Rename bookmark folder", Content = name, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
                if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(name.Text))
                {
                    await _bookmarks.UpdateFolderAsync(selected.Id, name.Text);
                    await LoadFolders(); await Load(); ReloadFolderList(); await RefreshBookmarkBarAsync();
                }
            };
            delete.Click += async (_, _) =>
            {
                if (folderList.SelectedItem is not ListViewItem item || item.Tag is not BookmarkFolder selected) return;
                if (!await ConfirmAsync("Delete bookmark folder?", $"Delete '{FolderLabel(selected)}'? Bookmarks in it will be kept but moved out of the deleted folder.", "Delete folder")) return;
                await _bookmarks.DeleteFolderAsync(selected.Id);
                await LoadFolders(); await Load(); ReloadFolderList(); await RefreshBookmarkBarAsync();
            };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { rename, delete } };
            var panel = new StackPanel { Spacing = 10, Children = { new TextBlock { Text = "Folders keep imported and saved bookmarks organized. Nested folders are shown with their full path.", TextWrapping = TextWrapping.Wrap }, folderList, buttons } };
            var dialog = new ContentDialog { Title = "Manage bookmark folders", Content = panel, CloseButtonText = "Done", XamlRoot = _root.XamlRoot };
            await dialog.ShowAsync();
        });
        var clearAll = ActionButton("Delete all", Symbol.Delete, async () =>
        {
            if (!await ConfirmAsync("Delete all bookmarks?", "This permanently removes every saved bookmark and bookmark folder from Sutra. This cannot be undone.", "Delete all")) return;
            await _bookmarks.DeleteAllAsync();
            await LoadFolders(); await Load(); await RefreshBookmarkBarAsync();
            ShowStatus("All bookmarks and folders deleted", InfoBarSeverity.Success);
        });
        var bookmarkAll = ActionButton("Bookmark all tabs", Symbol.OutlineStar, async () =>
        {
            var name = new TextBox { Header = "Folder name", Text = $"Tabs {DateTime.Now:g}", MinWidth = 320, MaxLength = 80 };
            var dialog = new ContentDialog { Title = "Bookmark all open tabs", Content = name, PrimaryButtonText = "Save tabs", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(name.Text)) return;
            var folderId = await _bookmarks.AddFolderAsync(name.Text);
            foreach (var tab in _vm.Tabs.Where(x => Uri.TryCreate(x.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")) await _bookmarks.AddAsync(tab.Title, tab.Url, folderId);
            await LoadFolders(); await Load(); await RefreshBookmarkBarAsync(); ShowStatus("Open tabs bookmarked", InfoBarSeverity.Success);
        });
        var import = ActionButton("Import HTML", Symbol.Download, async () => await ImportBookmarksAsync(LoadFolders, Load));
        var export = ActionButton("Export HTML", Symbol.Upload, ExportBookmarksAsync);
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(search); toolbar.Children.Add(folderFilter); toolbar.Children.Add(open); toolbar.Children.Add(newTab); toolbar.Children.Add(newWindow); toolbar.Children.Add(edit); toolbar.Children.Add(remove); toolbar.Children.Add(addFolder); toolbar.Children.Add(manageFolders); toolbar.Children.Add(bookmarkAll); toolbar.Children.Add(import); toolbar.Children.Add(export); toolbar.Children.Add(clearAll);
        var body = PageBody(toolbar, list);
        await LoadFolders(); await Load();
        ShowPage("Bookmarks", "Saved locally and available in normal and private windows.", body);
    }

    private async Task ImportBookmarksAsync(Func<Task> reloadFolders, Func<Task> reloadBookmarks)
    {
        var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
        picker.FileTypeFilter.Add(".html"); picker.FileTypeFilter.Add(".htm");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        var parsed = BookmarkHtml.Parse(await FileIO.ReadTextAsync(file));
        if (parsed.Count == 0) { ShowStatus("No supported web bookmarks were found in that file.", InfoBarSeverity.Warning); return; }
        var existing = (await _bookmarks.SearchAsync()).Select(x => x.Url).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var folderId = await _bookmarks.AddFolderAsync($"Imported {DateTime.Now:d}");
        var added = 0;
        foreach (var entry in parsed.Where(x => existing.Add(x.Url))) { await _bookmarks.AddAsync(entry.Title, entry.Url, folderId); added++; }
        await reloadFolders(); await reloadBookmarks(); await RefreshBookmarkBarAsync();
        ShowStatus($"Imported {added} bookmark{(added == 1 ? "" : "s")}", InfoBarSeverity.Success);
    }

    private async void ExportBookmarksAsync()
    {
        var picker = new FileSavePicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary, SuggestedFileName = "Sutra bookmarks" };
        picker.FileTypeChoices.Add("Bookmark HTML", [".html"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file is null) return;
        var entries = (await _bookmarks.SearchAsync()).Select(x => new BookmarkHtmlEntry(x.Title, x.Url));
        await FileIO.WriteTextAsync(file, BookmarkHtml.Export(entries, "Sutra Browser bookmarks"));
        ShowStatus("Bookmarks exported", InfoBarSeverity.Success);
    }

    private async Task ShowDownloadsAsync()
    {
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        async Task Load()
        {
            list.Items.Clear();
            var records = _isPrivate ? _privateDownloads.Values.OrderByDescending(x => x.StartedAt).ToList() : (await _downloads.ListAsync()).ToList();
            DateTime? lastDate = null;
            foreach (var download in records)
            {
                var date = download.StartedAt.LocalDateTime.Date;
                if (date != lastDate)
                {
                    list.Items.Add(new TextBlock { Text = date == DateTime.Today ? "Today" : date.ToString("D"), FontWeight = FontWeights.SemiBold, Margin = new(8, 14, 8, 4), IsHitTestVisible = false });
                    lastDate = date;
                }
                var total = download.TotalBytes is > 0 ? $"{download.BytesReceived * 100d / download.TotalBytes.Value:0}%" : $"{download.BytesReceived / 1024d:0} KB";
                list.Items.Add(new ListViewItem { Tag = download, Content = ManagerRow(download.FileName, $"{download.State}  ·  {total}\n{download.Destination}{(download.Error is null ? "" : $"\n{download.Error}")}") });
            }
        }
        var open = ActionButton("Open file", Symbol.OpenFile, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is DownloadRecord download && File.Exists(download.Destination)) await Launcher.LaunchFileAsync(await StorageFile.GetFileFromPathAsync(download.Destination)); });
        var folder = ActionButton("Open folder", Symbol.Folder, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is DownloadRecord download && Directory.Exists(Path.GetDirectoryName(download.Destination))) await Launcher.LaunchFolderAsync(await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(download.Destination)!)); });
        var cancel = ActionButton("Cancel", Symbol.Cancel, () => { if (list.SelectedItem is ListViewItem item && item.Tag is DownloadRecord download && _activeDownloads.TryGetValue(download.Id, out var operation)) operation.Cancel(); });
        var retry = ActionButton("Retry source", Symbol.Refresh, () => { if (list.SelectedItem is ListViewItem item && item.Tag is DownloadRecord download) NewTab(download.SourceUrl, activate: !_vm.Settings.OpenLinksInBackground); });
        var remove = ActionButton("Remove", Symbol.Delete, async () =>
        {
            if (list.SelectedItem is not ListViewItem item || item.Tag is not DownloadRecord download || download.State == "InProgress") return;
            if (_isPrivate) _privateDownloads.Remove(download.Id); else await _downloads.DeleteAsync(download.Id);
            await Load();
        });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(open); toolbar.Children.Add(folder); toolbar.Children.Add(cancel); toolbar.Children.Add(retry); toolbar.Children.Add(remove);
        var body = PageBody(toolbar, list);
        await Load();
        ShowPage("Downloads", _isPrivate ? "Private download files remain on disk, but Sutra does not add them to normal download history." : "Files downloaded through Sutra.", body);
    }

    private async Task ShowPasswordsAsync()
    {
        if (_isPrivate)
        {
            ShowPage("Passwords", "Password saving and saved-password access are disabled in private windows.", EmptyState(Symbol.Permissions, "Open a normal window to manage or fill saved logins."));
            return;
        }
        var search = new AutoSuggestBox { PlaceholderText = "Search saved logins", MinWidth = 320 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        async Task Load()
        {
            list.Items.Clear();
            foreach (var password in await _passwordMetadata.SearchAsync(search.Text ?? "")) list.Items.Add(new ListViewItem { Tag = password, Content = ManagerRow(password.Origin, $"{password.Username}  ·  Password: ••••••••") });
        }
        search.TextChanged += async (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) await Load(); };
        var fill = ActionButton("Fill on this page", Symbol.Go, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is PasswordMetadataRecord password) await AutofillAsync(password); });
        var add = ActionButton("Add login", Symbol.Add, async () => { await SaveLoginAsync(); await Load(); });
        var edit = ActionButton("Edit", Symbol.Edit, async () =>
        {
            if (list.SelectedItem is not ListViewItem item || item.Tag is not PasswordMetadataRecord metadata) return;
            var username = new TextBox { Header = "Username", Text = metadata.Username, MinWidth = 340 };
            var replacement = new PasswordBox { Header = "New password", PlaceholderText = "Leave blank to keep the current password" };
            var panel = new StackPanel { Spacing = 9 }; panel.Children.Add(username); panel.Children.Add(replacement);
            var dialog = new ContentDialog { Title = "Edit saved login", Content = panel, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(username.Text)) { replacement.Password = string.Empty; return; }
            var current = await _credentials.GetForOriginAsync(metadata.Id, new Uri(metadata.Origin));
            if (current is null) { replacement.Password = string.Empty; ShowStatus("Secure credential storage is unavailable.", InfoBarSeverity.Error); return; }
            var secret = string.IsNullOrEmpty(replacement.Password) ? current.Password : replacement.Password;
            await _credentials.SaveAsync(metadata.Origin, username.Text, secret, metadata.Id);
            replacement.Password = string.Empty; secret = string.Empty; await Load(); ShowStatus("Saved login updated", InfoBarSeverity.Success);
        });
        var reveal = ActionButton("Reveal", Symbol.View, async () =>
        {
            if (list.SelectedItem is not ListViewItem item || item.Tag is not PasswordMetadataRecord metadata) return;
            var secret = await _credentials.GetForOriginAsync(metadata.Id, new Uri(metadata.Origin));
            if (secret is null) return;
            var shown = new TextBox { Header = "Password", Text = secret.Password, IsReadOnly = true, MinWidth = 340 };
            try { await new ContentDialog { Title = $"Password for {metadata.Origin}", Content = shown, CloseButtonText = "Hide", XamlRoot = _root.XamlRoot }.ShowAsync(); }
            finally { shown.Text = string.Empty; }
        });
        var copyUser = ActionButton("Copy username", Symbol.Copy, () => { if (list.SelectedItem is ListViewItem item && item.Tag is PasswordMetadataRecord password) { SetClipboard(password.Username); ShowStatus("Username copied"); } });
        var copyPassword = ActionButton("Copy password for 30s", Symbol.Copy, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is PasswordMetadataRecord password) { var secret = await _credentials.GetForOriginAsync(password.Id, new Uri(password.Origin)); if (secret is not null) { SetClipboard(secret.Password); ScheduleClipboardClear(secret.Password); ShowStatus("Password copied. Clipboard clears in 30 seconds."); } } });
        var delete = ActionButton("Delete", Symbol.Delete, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is PasswordMetadataRecord password && await ConfirmAsync("Delete saved login?", $"Remove the saved login for {password.Origin}?", "Delete")) { await _credentials.DeleteAsync(password.Id); await Load(); } });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(search); toolbar.Children.Add(fill); toolbar.Children.Add(add); toolbar.Children.Add(edit); toolbar.Children.Add(reveal); toolbar.Children.Add(copyUser); toolbar.Children.Add(copyPassword); toolbar.Children.Add(delete);
        var body = PageBody(toolbar, list);
        await Load();
        ShowPage("Passwords", "Secrets are encrypted locally and restricted to their exact HTTPS origin.", body);
    }

    private async Task SaveLoginAsync()
    {
        if (_isPrivate) { await NoticeAsync("Unavailable in private browsing", "Password saving is disabled in private windows."); return; }
        var tab = _vm.SelectedTab;
        if (tab is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme != "https") { await NoticeAsync("Passwords require HTTPS", "Navigate to a secure HTTPS page before saving a login."); return; }
        var username = new TextBox { Header = "Username" }; var password = new PasswordBox { Header = "Password" }; var generate = new Button { Content = "Generate strong password" };
        generate.Click += (_, _) => password.Password = PasswordGenerator.Generate();
        var panel = new StackPanel { Spacing = 8 }; panel.Children.Add(username); panel.Children.Add(password); panel.Children.Add(generate);
        var dialog = new ContentDialog { Title = $"Save login for {uri.Host}", Content = panel, PrimaryButtonText = "Save securely", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(username.Text) && !string.IsNullOrEmpty(password.Password))
        {
            await _credentials.SaveAsync(uri.GetLeftPart(UriPartial.Authority), username.Text, password.Password);
            password.Password = string.Empty;
            ShowStatus("Login saved securely", InfoBarSeverity.Success);
        }
    }

    private async Task HandleCredentialSubmittedAsync(BrowserTab tab, string messageSource, JsonElement message)
    {
        if (_isPrivate || tab.Id != _vm.SelectedTab?.Id || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var page) || page.Scheme != "https" ||
            !Uri.TryCreate(messageSource, UriKind.Absolute, out var source) || !CredentialOrigin.IsExactMatch(page.GetLeftPart(UriPartial.Authority), source)) return;
        var username = message.TryGetProperty("username", out var userValue) ? userValue.GetString()?.Trim() : null;
        var password = message.TryGetProperty("password", out var passwordValue) ? passwordValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password) || password.Length > 4096) return;
        var origin = source.GetLeftPart(UriPartial.Authority);
        var existing = (await _passwordMetadata.SearchAsync()).FirstOrDefault(x => x.Origin.Equals(origin, StringComparison.OrdinalIgnoreCase) && x.Username.Equals(username, StringComparison.Ordinal));
        var dialog = new ContentDialog
        {
            Title = existing is null ? "Save login?" : "Update saved password?",
            Content = $"{origin}\nUsername: {username}\n\nThe password will be encrypted with Windows secure storage and will never be shared with Copilot.",
            PrimaryButtonText = existing is null ? "Save" : "Update",
            CloseButtonText = "Not now",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = _root.XamlRoot
        };
        try
        {
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                await _credentials.SaveAsync(origin, username, password, existing?.Id);
                ShowStatus(existing is null ? "Login saved securely" : "Saved password updated", InfoBarSeverity.Success);
            }
        }
        catch { ShowStatus("The login could not be saved because secure credential storage is unavailable.", InfoBarSeverity.Error, 7000); }
        finally { password = string.Empty; }
    }

    private async Task AutofillAsync(PasswordMetadataRecord metadata)
    {
        if (_isPrivate) { await NoticeAsync("Unavailable in private browsing", "Saved-password access is disabled in private windows."); return; }
        var web = CurrentWebView();
        if (web?.Source is null || !CredentialOrigin.IsExactMatch(metadata.Origin, web.Source)) { await NoticeAsync("Origin mismatch", "This login can only be filled on its exact HTTPS origin."); return; }
        var confirm = new ContentDialog { Title = "Fill saved password?", Content = $"Fill the saved login for {metadata.Username} into {metadata.Origin}? The password stays inside the browser and is never sent to AI.", PrimaryButtonText = "Fill", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close, XamlRoot = _root.XamlRoot };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        var secret = await _credentials.GetForOriginAsync(metadata.Id, web.Source); if (secret is null) return;
        var user = JsonSerializer.Serialize(secret.Username); var pass = JsonSerializer.Serialize(secret.Password);
        await web.ExecuteScriptAsync($"(()=>{{const u=document.querySelector('input[autocomplete=username],input[type=email],input[type=text]');const p=document.querySelector('input[type=password]');if(u){{u.value={user};u.dispatchEvent(new Event('input',{{bubbles:true}}));}}if(p){{p.value={pass};p.dispatchEvent(new Event('input',{{bubbles:true}}));}}return !!p;}})()");
        ShowStatus("Login filled after your approval", InfoBarSeverity.Success);
    }

    private async Task FindInPageAsync()
    {
        ShowFindBar();
        await Task.CompletedTask;
    }

    private Task SearchTabsAsync()
    {
        var search = new AutoSuggestBox { PlaceholderText = "Search open tabs", MinWidth = 340 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Multiple };
        void Load()
        {
            list.Items.Clear();
            foreach (var tab in _vm.Tabs.Where(x => string.IsNullOrWhiteSpace(search.Text) || x.Title.Contains(search.Text, StringComparison.OrdinalIgnoreCase) || x.Url.Contains(search.Text, StringComparison.OrdinalIgnoreCase)))
                list.Items.Add(new ListViewItem { Tag = tab, Content = ManagerRow(tab.Title, $"{tab.Url}{(tab.IsHibernated ? "  ·  Sleeping" : string.Empty)}") });
        }
        search.TextChanged += (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) Load(); };
        list.DoubleTapped += async (_, _) => { if (list.SelectedItem is ListViewItem item && item.Tag is BrowserTab tab) { HidePage(); await ActivateTabAsync(tab); } };
        var open = ActionButton("Switch", Symbol.Go, async () => { if (list.SelectedItem is ListViewItem item && item.Tag is BrowserTab tab) { HidePage(); await ActivateTabAsync(tab); } });
        var sleep = ActionButton("Hibernate selected", Symbol.Clock, async () =>
        {
            foreach (var tab in list.SelectedItems.OfType<ListViewItem>().Select(x => x.Tag).OfType<BrowserTab>().ToList()) await HibernateTabAsync(tab);
            Load();
        });
        var close = ActionButton("Close selected", Symbol.Cancel, () =>
        {
            foreach (var tab in list.SelectedItems.OfType<ListViewItem>().Select(x => x.Tag).OfType<BrowserTab>().ToList()) CloseTab(tab);
            Load();
        });
        var duplicates = ActionButton("Close duplicates", Symbol.Copy, async () =>
        {
            var duplicateTabs = _vm.Tabs.Where(x => x.Url != "browser://newtab")
                .GroupBy(x => x.Url.TrimEnd('/'), StringComparer.OrdinalIgnoreCase)
                .SelectMany(group => group.Skip(1)).Where(x => !IsProtectedTab(x)).ToList();
            if (duplicateTabs.Count == 0) { ShowStatus("No unprotected duplicate tabs found"); return; }
            if (!await ConfirmAsync("Close duplicate tabs?", $"Close {duplicateTabs.Count} duplicate tab{(duplicateTabs.Count == 1 ? "" : "s")}? Pinned and protected tabs will remain open.", "Close duplicates")) return;
            foreach (var tab in duplicateTabs) CloseTab(tab);
            Load();
        });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(search); toolbar.Children.Add(open); toolbar.Children.Add(sleep); toolbar.Children.Add(close); toolbar.Children.Add(duplicates);
        Load();
        ShowPage("Search tabs", "Find an open, pinned, or sleeping tab.", PageBody(toolbar, list));
        return Task.CompletedTask;
    }

    private Task ShowCustomizationAsync()
    {
        var theme = new ComboBox { Header = "Browser theme", ItemsSource = Enum.GetNames<BrowserTheme>(), SelectedItem = _vm.Settings.Theme.ToString(), MinWidth = 220 };
        var newTab = new ComboBox { Header = "Browser and new-tab appearance", ItemsSource = Enum.GetNames<NewTabAppearance>(), SelectedItem = _vm.Settings.NewTabAppearance.ToString(), MinWidth = 220 };
        var layout = new ComboBox { Header = "Tab layout", ItemsSource = Enum.GetNames<TabLayout>(), SelectedItem = _vm.Settings.TabLayout.ToString(), MinWidth = 220 };
        var density = new ComboBox { Header = "Toolbar density", ItemsSource = Enum.GetNames<ToolbarDensity>(), SelectedItem = _vm.Settings.ToolbarDensity.ToString(), MinWidth = 220 };
        var accent = new TextBox { Header = "Custom accent", Text = _vm.Settings.AccentColor, PlaceholderText = "#4C8DFF", MaxWidth = 220, HorizontalAlignment = HorizontalAlignment.Left };
        var customColors = new ToggleSwitch { Header = "Use custom browser colors", IsOn = _vm.Settings.UseCustomThemeColors };
        var surfaceColor = new TextBox { Header = "Browser surface color", Text = _vm.Settings.ThemeSurfaceColor, PlaceholderText = "#202126", MaxWidth = 220, HorizontalAlignment = HorizontalAlignment.Left };
        var textColor = new TextBox { Header = "New-tab text color", Text = _vm.Settings.ThemeTextColor, PlaceholderText = "#F5F5F5", MaxWidth = 220, HorizontalAlignment = HorizontalAlignment.Left };
        var backgroundPath = _vm.Settings.NewTabBackgroundPath;
        var backgroundLabel = new TextBlock { Text = string.IsNullOrWhiteSpace(backgroundPath) ? "No custom image" : Path.GetFileName(backgroundPath), Opacity = .65, VerticalAlignment = VerticalAlignment.Center };
        var chooseBackground = ActionButton("Choose local image", Symbol.Pictures, async () =>
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
            picker.FileTypeFilter.Add(".jpg"); picker.FileTypeFilter.Add(".jpeg"); picker.FileTypeFilter.Add(".png"); picker.FileTypeFilter.Add(".webp");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            var file = await picker.PickSingleFileAsync(); if (file is null) return;
            var properties = await file.GetBasicPropertiesAsync();
            if (properties.Size > 20_000_000) { ShowStatus("Choose an image smaller than 20 MB.", InfoBarSeverity.Warning); return; }
            var directory = Path.Combine(_paths.Root, "Customization"); Directory.CreateDirectory(directory);
            var target = Path.Combine(directory, "new-tab" + Path.GetExtension(file.Name).ToLowerInvariant());
            File.Copy(file.Path, target, true); backgroundPath = target; backgroundLabel.Text = file.Name;
        });
        var clearBackground = ActionButton("Remove image", Symbol.Delete, () => { backgroundPath = ""; backgroundLabel.Text = "No custom image"; });
        var backgroundRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; backgroundRow.Children.Add(chooseBackground); backgroundRow.Children.Add(clearBackground); backgroundRow.Children.Add(backgroundLabel);
        var swatches = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var value in new[] { "#4C8DFF", "#7C5CFC", "#008A78", "#C43E5C", "#D06B18", "#68717A" })
        {
            var color = Windows.UI.Color.FromArgb(255, Convert.ToByte(value[1..3], 16), Convert.ToByte(value[3..5], 16), Convert.ToByte(value[5..7], 16));
            var swatch = new Button { Width = 34, Height = 34, Padding = new(0), CornerRadius = new(17), Background = new SolidColorBrush(color), BorderThickness = new(1), Tag = value };
            ToolTipService.SetToolTip(swatch, value);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(swatch, $"Accent color {value}");
            swatch.Click += (_, _) => accent.Text = (string)swatch.Tag;
            swatches.Children.Add(swatch);
        }

        var bookmarkBar = new ToggleSwitch { Header = "Bookmark bar", IsOn = _vm.Settings.BookmarkBarVisible };
        var sidebarCollapsed = new ToggleSwitch { Header = "Start vertical sidebar collapsed", IsOn = _vm.Settings.SidebarCollapsed };
        var sidebarAutoHide = new ToggleSwitch { Header = "Auto-hide vertical sidebar (peek on hover)", IsOn = _vm.Settings.SidebarAutoHide };
        var sidebarWidth = new NumberBox { Header = "Sidebar width (px)", Minimum = 180, Maximum = 520, SmallChange = 10, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact, Value = _vm.Settings.SidebarWidth };
        var pinned = new ToggleSwitch { Header = "Pinned bookmarks on new tab", IsOn = _vm.Settings.ShowPinnedBookmarksOnNewTab };
        var frequent = new ToggleSwitch { Header = "Frequently visited sites on new tab", IsOn = _vm.Settings.ShowFrequentSitesOnNewTab };
        var closed = new ToggleSwitch { Header = "Recently closed tabs on new tab", IsOn = _vm.Settings.ShowRecentlyClosedOnNewTab };
        var home = new ToggleSwitch { Header = "Home button", IsOn = _vm.Settings.ShowHomeButton };
        var bookmark = new ToggleSwitch { Header = "Bookmark button", IsOn = _vm.Settings.ShowBookmarkButton };
        var ai = new ToggleSwitch { Header = "AI button", IsOn = _vm.Settings.ShowAiButton };
        var split = new ToggleSwitch { Header = "Split-screen button", IsOn = _vm.Settings.ShowSplitButton };
        var media = new ToggleSwitch { Header = "Media button", IsOn = _vm.Settings.ShowMediaButton };
        var toolbarOrder = new ListView { Height = 250, SelectionMode = ListViewSelectionMode.Single };
        foreach (var item in _vm.Settings.ToolbarOrder) toolbarOrder.Items.Add(item);
        var moveUp = ActionButton("Move up", Symbol.Up, () =>
        {
            var index = toolbarOrder.SelectedIndex; if (index <= 0) return; var item = toolbarOrder.Items[index]; toolbarOrder.Items.RemoveAt(index); toolbarOrder.Items.Insert(index - 1, item); toolbarOrder.SelectedIndex = index - 1;
        });
        var moveDown = ActionButton("Move down", Symbol.Forward, () =>
        {
            var index = toolbarOrder.SelectedIndex; if (index < 0 || index >= toolbarOrder.Items.Count - 1) return; var item = toolbarOrder.Items[index]; toolbarOrder.Items.RemoveAt(index); toolbarOrder.Items.Insert(index + 1, item); toolbarOrder.SelectedIndex = index + 1;
        });
        var orderActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; orderActions.Children.Add(moveUp); orderActions.Children.Add(moveDown);

        var stack = new StackPanel { Spacing = 14, MaxWidth = 720, HorizontalAlignment = HorizontalAlignment.Left };
        stack.Children.Add(SettingsSection("Color and theme", "Use six-digit hex colors, for example #202126. Custom colors update Sutra's chrome and new-tab page locally; they are never uploaded.", theme, newTab, accent, customColors, surfaceColor, textColor, swatches, backgroundRow));
        stack.Children.Add(SettingsSection("Browser layout", "Choose the tab placement and how much space the toolbar uses.", layout, sidebarCollapsed, sidebarAutoHide, sidebarWidth, density, bookmarkBar));
        stack.Children.Add(SettingsSection("New-tab content", "All sections are generated only from local bookmarks, history, and recently closed tabs.", pinned, frequent, closed));
        stack.Children.Add(SettingsSection("Toolbar buttons", "Keep the controls you use and hide the rest.", home, bookmark, ai, split, media));
        stack.Children.Add(SettingsSection("Toolbar order", "Select an item and move it. The address bar remains flexible wherever you place it.", toolbarOrder, orderActions));
        var scroll = new ScrollViewer { Content = stack, Padding = new(0, 0, 12, 24) };

        var save = new Button { Content = "Apply customization", CornerRadius = new(8) };
        save.Click += async (_, _) =>
        {
            Enum.TryParse<BrowserTheme>(theme.SelectedItem?.ToString(), out var selectedTheme);
            Enum.TryParse<NewTabAppearance>(newTab.SelectedItem?.ToString(), out var selectedNewTab);
            Enum.TryParse<TabLayout>(layout.SelectedItem?.ToString(), out var selectedLayout);
            Enum.TryParse<ToolbarDensity>(density.SelectedItem?.ToString(), out var selectedDensity);
            _vm.Settings = SettingsValidator.Validate(_vm.Settings with
            {
                Theme = selectedTheme,
                NewTabAppearance = selectedNewTab,
                TabLayout = selectedLayout,
                SidebarCollapsed = sidebarCollapsed.IsOn,
                SidebarAutoHide = sidebarAutoHide.IsOn,
                SidebarWidth = (int)sidebarWidth.Value,
                ToolbarDensity = selectedDensity,
                AccentColor = accent.Text,
                UseCustomThemeColors = customColors.IsOn,
                ThemeSurfaceColor = surfaceColor.Text,
                ThemeTextColor = textColor.Text,
                NewTabBackgroundPath = backgroundPath,
                ToolbarOrder = toolbarOrder.Items.OfType<string>().ToArray(),
                BookmarkBarVisible = bookmarkBar.IsOn,
                ShowPinnedBookmarksOnNewTab = pinned.IsOn,
                ShowFrequentSitesOnNewTab = frequent.IsOn,
                ShowRecentlyClosedOnNewTab = closed.IsOn,
                ShowHomeButton = home.IsOn,
                ShowBookmarkButton = bookmark.IsOn,
                ShowAiButton = ai.IsOn,
                ShowSplitButton = split.IsOn,
                ShowMediaButton = media.IsOn
            });
            await SaveSettingsSafeAsync();
            ApplyTheme(); ApplyCustomization(); ApplyTabLayout(); await RefreshBookmarkBarAsync();
            HidePage();
            foreach (var tab in _vm.Tabs.Where(x => x.Url == "browser://newtab"))
                if (_webViews.TryGetValue(tab.Id, out var web)) await ShowNewTabPageAsync(web);
            ShowStatus("Customization saved. Restart Sutra to apply the native light/dark theme safely.", InfoBarSeverity.Success, 6500);
        };
        var reset = new Button { Content = "Restore appearance defaults", CornerRadius = new(8) };
        reset.Click += (_, _) =>
        {
            var defaults = new BrowserSettings();
            theme.SelectedItem = defaults.Theme.ToString(); newTab.SelectedItem = defaults.NewTabAppearance.ToString(); layout.SelectedItem = defaults.TabLayout.ToString(); density.SelectedItem = defaults.ToolbarDensity.ToString(); accent.Text = defaults.AccentColor; customColors.IsOn = defaults.UseCustomThemeColors; surfaceColor.Text = defaults.ThemeSurfaceColor; textColor.Text = defaults.ThemeTextColor;
            bookmarkBar.IsOn = defaults.BookmarkBarVisible; sidebarCollapsed.IsOn = defaults.SidebarCollapsed; sidebarAutoHide.IsOn = defaults.SidebarAutoHide; sidebarWidth.Value = defaults.SidebarWidth; pinned.IsOn = defaults.ShowPinnedBookmarksOnNewTab; frequent.IsOn = defaults.ShowFrequentSitesOnNewTab; closed.IsOn = defaults.ShowRecentlyClosedOnNewTab;
            home.IsOn = defaults.ShowHomeButton; bookmark.IsOn = defaults.ShowBookmarkButton; ai.IsOn = defaults.ShowAiButton; split.IsOn = defaults.ShowSplitButton; media.IsOn = defaults.ShowMediaButton;
            backgroundPath = defaults.NewTabBackgroundPath; backgroundLabel.Text = "No custom image"; toolbarOrder.Items.Clear(); foreach (var item in defaults.ToolbarOrder) toolbarOrder.Items.Add(item);
        };
        ShowPage("Customize Sutra", "Personalize the browser shell and new-tab page.", scroll, reset, save);
        return Task.CompletedTask;
    }

    private Task ShowSettingsAsync()
    {
        var theme = new ComboBox { Header = "Application theme", ItemsSource = Enum.GetNames<BrowserTheme>(), SelectedItem = _vm.Settings.Theme.ToString() };
        var scheduledTheme = new ToggleSwitch { Header = "Switch light and dark themes on a schedule", IsOn = _vm.Settings.UseScheduledTheme };
        var darkHour = new NumberBox { Header = "Dark theme starts (24-hour clock)", Minimum = 0, Maximum = 23, Value = _vm.Settings.DarkThemeStartHour, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var lightHour = new NumberBox { Header = "Light theme starts (24-hour clock)", Minimum = 0, Maximum = 23, Value = _vm.Settings.LightThemeStartHour, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var layout = new ComboBox { Header = "Tab layout", ItemsSource = Enum.GetNames<TabLayout>(), SelectedItem = _vm.Settings.TabLayout.ToString() };
        var sidebarCollapsed = new ToggleSwitch { Header = "Collapse vertical sidebar by default", IsOn = _vm.Settings.SidebarCollapsed };
        var sidebarAutoHide = new ToggleSwitch { Header = "Auto-hide vertical sidebar (peek on hover)", IsOn = _vm.Settings.SidebarAutoHide };
        var sidebarWidth = new NumberBox { Header = "Sidebar width (px)", Minimum = 180, Maximum = 520, SmallChange = 10, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact, Value = _vm.Settings.SidebarWidth };
        var density = new ComboBox { Header = "Toolbar density", ItemsSource = Enum.GetNames<ToolbarDensity>(), SelectedItem = _vm.Settings.ToolbarDensity.ToString() };
        var accent = new TextBox { Header = "Accent color", Text = _vm.Settings.AccentColor, PlaceholderText = "#4C8DFF" };
        var bookmarkBar = new ToggleSwitch { Header = "Show bookmark bar", IsOn = _vm.Settings.BookmarkBarVisible };
        var showHome = new ToggleSwitch { Header = "Home button", IsOn = _vm.Settings.ShowHomeButton };
        var showBookmark = new ToggleSwitch { Header = "Bookmark button", IsOn = _vm.Settings.ShowBookmarkButton };
        var showAi = new ToggleSwitch { Header = "AI button", IsOn = _vm.Settings.ShowAiButton };
        var showSplit = new ToggleSwitch { Header = "Split-screen button", IsOn = _vm.Settings.ShowSplitButton };
        var showMedia = new ToggleSwitch { Header = "Media button", IsOn = _vm.Settings.ShowMediaButton };
        var engine = new ComboBox { Header = "Default search engine", ItemsSource = Enum.GetNames<SearchEngine>(), SelectedItem = _vm.Settings.SearchEngine.ToString() };
        var searchAliases = new TextBox { Header = "Custom search aliases", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 72, PlaceholderText = "yt=https://www.youtube.com/results?search_query={query}\nwiki=https://en.wikipedia.org/w/index.php?search={query}", Text = string.Join(Environment.NewLine, _vm.Settings.SearchAliases.OrderBy(x => x.Key).Select(x => $"{x.Key}={x.Value}")) };
        var home = new TextBox { Header = "Home page", Text = _vm.Settings.HomePage };
        var restore = new ToggleSwitch { Header = "Restore previous session", IsOn = _vm.Settings.StartupBehavior == StartupBehavior.RestorePreviousSession };
        var backgroundLinkTabs = new ToggleSwitch { Header = "Open link and bookmark tabs in the background", IsOn = _vm.Settings.OpenLinksInBackground };
        var preventDuplicates = new ToggleSwitch { Header = "Focus an existing tab instead of opening duplicate URLs", IsOn = _vm.Settings.PreventDuplicateTabs };
        var suggestGroups = new ToggleSwitch { Header = "Suggest grouping ungrouped tabs from the same site", IsOn = _vm.Settings.SuggestTabGroupsByDomain };
        var protectedClose = new ToggleSwitch { Header = "Confirm before closing protected tabs", IsOn = _vm.Settings.ConfirmClosingProtectedTabs };
        var history = new ToggleSwitch { Header = "Record local history", IsOn = _vm.Settings.HistoryEnabled };
        var adBlocking = new ToggleSwitch { Header = "Block ads and trackers", IsOn = _vm.Settings.AdBlockingEnabled };
        var cosmeticBlocking = new ToggleSwitch { Header = "Hide blocked ad containers", IsOn = _vm.Settings.CosmeticFilteringEnabled };
        var adAllowlist = new TextBox { Header = "Sites where protection is disabled", PlaceholderText = "example.com, trusted.example.org", Text = string.Join(", ", _vm.Settings.AdBlockAllowlist) };
        var filterUrls = new TextBox { Header = "Filter-list URLs", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 72, Text = string.Join(Environment.NewLine, _vm.Settings.FilterListUrls) };
        var cleanLinks = new ToggleSwitch { Header = "Remove common tracking parameters when copying clean links", IsOn = _vm.Settings.RemoveTrackingParametersFromCopiedLinks };
        var hibernate = new ToggleSwitch { Header = "Automatically hibernate inactive tabs", IsOn = _vm.Settings.AutomaticHibernationEnabled };
        var minutes = new NumberBox { Header = "Inactivity threshold (minutes)", Minimum = 1, Maximum = 10080, Value = _vm.Settings.HibernationMinutes, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var exclusions = new TextBox { Header = "Sites that stay awake", PlaceholderText = "example.com, calls.example.org", Text = string.Join(", ", _vm.Settings.HibernationExclusions) };
        var downloadFolder = new TextBox { Header = "Download folder", Text = _vm.Settings.DownloadFolder };
        var provider = new ComboBox { Header = "AI provider", ItemsSource = Enum.GetNames<AiProviderKind>(), SelectedItem = _vm.Settings.AiProvider.ToString() };
        var endpoint = new TextBox { Header = "OpenAI-compatible endpoint", Text = _vm.Settings.OpenAiEndpoint };
        var model = new TextBox { Header = "AI model", Text = _vm.Settings.AiProvider == AiProviderKind.Ollama ? _vm.Settings.OllamaModel : _vm.Settings.OpenAiModel };
        var apiKey = new PasswordBox { Header = "OpenAI-compatible API key", PlaceholderText = "Leave blank to keep the current encrypted key" };

        var dataActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var reviewPermissions = ActionButton("Review permissions", Symbol.Permissions, async () => await ShowPermissionsAsync());
        var clearPermissions = ActionButton("Permissions", Symbol.Delete, async () => { if (await ConfirmAsync("Reset permissions?", "Remove all saved site permission decisions?", "Reset")) { await _permissions.ClearAsync(); ShowStatus("Site permissions reset"); } });
        var clearHistory = ActionButton("History", Symbol.Delete, async () => { if (await ConfirmAsync("Clear all history?", "This cannot be undone.", "Clear")) { await _history.ClearAllAsync(); ShowStatus("History cleared"); } });
        var clearCookies = ActionButton("Cookies", Symbol.Delete, async () => await ClearProfileDataAsync(CoreWebView2BrowsingDataKinds.Cookies, "Cookies cleared"));
        var clearCache = ActionButton("Cache", Symbol.Delete, async () => await ClearProfileDataAsync(CoreWebView2BrowsingDataKinds.DiskCache, "Cache cleared"));
        var clearSiteData = ActionButton("Site data", Symbol.Delete, async () => await ClearProfileDataAsync(CoreWebView2BrowsingDataKinds.AllSite, "Site data cleared"));
        var clearDownloads = ActionButton("Download history", Symbol.Delete, async () => { await _downloads.ClearAsync(); ShowStatus("Download history cleared"); });
        foreach (var button in new[] { reviewPermissions, clearPermissions, clearHistory, clearCookies, clearCache, clearSiteData, clearDownloads }) dataActions.Children.Add(button);

        var stack = new StackPanel { Spacing = 14, MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left };
        stack.Children.Add(SettingsSection("Appearance", "Choose the theme, density, accent, and toolbar controls that fit your desktop.", theme, scheduledTheme, darkHour, lightHour, layout, sidebarCollapsed, sidebarAutoHide, sidebarWidth, density, accent, bookmarkBar, showHome, showBookmark, showAi, showSplit, showMedia));
        stack.Children.Add(SettingsSection("Startup and search", "Control the first page and address-bar search provider. Use an alias followed by a space and your query (for example, yt lofi).", engine, searchAliases, home, restore));
        stack.Children.Add(SettingsSection("Tabs and performance", "The New tab button and Ctrl+T always switch to the new tab. Link-created tabs can stay in the background. Sleeping tabs release their WebView memory conservatively.", backgroundLinkTabs, preventDuplicates, suggestGroups, protectedClose, hibernate, minutes, exclusions));
        stack.Children.Add(SettingsSection("Downloads and history", "These settings apply to normal windows. Private windows do not write history.", downloadFolder, history));
        stack.Children.Add(SettingsSection("Privacy protection", "Network requests are checked locally. Filter lists update only when you request it from the site-information panel.", adBlocking, cosmeticBlocking, adAllowlist, filterUrls, cleanLinks));
        stack.Children.Add(SettingsSection("AI provider", "Page content is shared only after you invoke Copilot. Remote provider keys are encrypted with Windows DPAPI.", provider, endpoint, model, apiKey));
        stack.Children.Add(SettingsSection("Clear browser data", "Choose exactly which locally stored data to remove.", dataActions));
        var scroll = new ScrollViewer { Content = stack, Padding = new(0, 0, 12, 24) };
        var save = new Button { Content = "Save settings", CornerRadius = new(8) };
        save.Click += async (_, _) =>
        {
            Enum.TryParse<BrowserTheme>(theme.SelectedItem?.ToString(), out var selectedTheme);
            Enum.TryParse<TabLayout>(layout.SelectedItem?.ToString(), out var selectedLayout);
            Enum.TryParse<ToolbarDensity>(density.SelectedItem?.ToString(), out var selectedDensity);
            Enum.TryParse<SearchEngine>(engine.SelectedItem?.ToString(), out var selectedEngine);
            Enum.TryParse<AiProviderKind>(provider.SelectedItem?.ToString(), out var selectedProvider);
            _vm.Settings = SettingsValidator.Validate(_vm.Settings with
            {
                Theme = selectedTheme,
                UseScheduledTheme = scheduledTheme.IsOn,
                DarkThemeStartHour = (int)darkHour.Value,
                LightThemeStartHour = (int)lightHour.Value,
                TabLayout = selectedLayout,
                SidebarCollapsed = sidebarCollapsed.IsOn,
                SidebarAutoHide = sidebarAutoHide.IsOn,
                SidebarWidth = (int)sidebarWidth.Value,
                ToolbarDensity = selectedDensity,
                AccentColor = accent.Text,
                BookmarkBarVisible = bookmarkBar.IsOn,
                ShowHomeButton = showHome.IsOn,
                ShowBookmarkButton = showBookmark.IsOn,
                ShowAiButton = showAi.IsOn,
                ShowSplitButton = showSplit.IsOn,
                ShowMediaButton = showMedia.IsOn,
                SearchEngine = selectedEngine,
                SearchAliases = ParseSearchAliases(searchAliases.Text),
                HomePage = home.Text,
                StartupBehavior = restore.IsOn ? StartupBehavior.RestorePreviousSession : StartupBehavior.NewTab,
                OpenToolbarTabsInBackground = false,
                OpenLinksInBackground = backgroundLinkTabs.IsOn,
                PreventDuplicateTabs = preventDuplicates.IsOn,
                SuggestTabGroupsByDomain = suggestGroups.IsOn,
                ConfirmClosingProtectedTabs = protectedClose.IsOn,
                HistoryEnabled = history.IsOn,
                AdBlockingEnabled = adBlocking.IsOn,
                CosmeticFilteringEnabled = cosmeticBlocking.IsOn,
                AdBlockAllowlist = adAllowlist.Text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                FilterListUrls = filterUrls.Text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                RemoveTrackingParametersFromCopiedLinks = cleanLinks.IsOn,
                AutomaticHibernationEnabled = hibernate.IsOn,
                HibernationMinutes = (int)minutes.Value,
                HibernationExclusions = exclusions.Text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                DownloadFolder = string.IsNullOrWhiteSpace(downloadFolder.Text) ? _vm.Settings.DownloadFolder : downloadFolder.Text,
                AiProvider = selectedProvider,
                OpenAiEndpoint = endpoint.Text,
                OllamaModel = selectedProvider == AiProviderKind.Ollama ? model.Text : _vm.Settings.OllamaModel,
                OpenAiModel = selectedProvider == AiProviderKind.OpenAiCompatible ? model.Text : _vm.Settings.OpenAiModel
            });
            if (!string.IsNullOrEmpty(apiKey.Password)) { await _secureStore.SaveAsync(OpenAiKeyId, new("api-key", apiKey.Password)); apiKey.Password = string.Empty; }
            await SaveSettingsSafeAsync();
            ApplyTheme(); ApplyCustomization(); ApplyTabLayout(); await RefreshBookmarkBarAsync(); HidePage(); ShowStatus("Settings saved. Restart Sutra to apply the native light/dark theme safely.", InfoBarSeverity.Success, 6500);
        };
        ShowPage("Settings", "Browser preferences are stored locally.", scroll, save);
        return Task.CompletedTask;
    }

    private static Dictionary<string, string> ParseSearchAliases(string? text)
    {
        var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in (text ?? string.Empty).Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var separator = line.IndexOf('=');
            if (separator <= 0 || separator == line.Length - 1) continue;
            aliases[line[..separator].Trim()] = line[(separator + 1)..].Trim();
        }
        return aliases;
    }

    private async Task ClearProfileDataAsync(CoreWebView2BrowsingDataKinds kinds, string status)
    {
        if (CurrentWebView()?.CoreWebView2?.Profile is not { } profile) return;
        await profile.ClearBrowsingDataAsync(kinds);
        ShowStatus(status, InfoBarSeverity.Success);
    }

    private async Task ShowPermissionsAsync()
    {
        if (_isPrivate) { ShowStatus("Private permission choices apply once and are not stored."); return; }
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        async Task Load()
        {
            list.Items.Clear();
            foreach (var permission in await _permissions.ListAllAsync())
                list.Items.Add(new ListViewItem { Tag = permission, Content = ManagerRow(permission.Origin, $"{permission.Kind}  ·  {permission.Decision}  ·  {permission.UpdatedAt.LocalDateTime:g}") });
        }
        var reset = ActionButton("Reset selected", Symbol.Delete, async () =>
        {
            if (list.SelectedItem is ListViewItem item && item.Tag is PermissionRecord permission) { await _permissions.DeleteAsync(permission.Origin, permission.Kind); await Load(); ShowStatus("Permission decision reset"); }
        });
        var resetSite = ActionButton("Reset site", Symbol.Delete, async () =>
        {
            if (list.SelectedItem is ListViewItem item && item.Tag is PermissionRecord permission) { await _permissions.DeleteOriginAsync(permission.Origin); await Load(); ShowStatus($"Permissions reset for {permission.Origin}"); }
        });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(reset); toolbar.Children.Add(resetSite);
        await Load();
        ShowPage("Site permissions", "Review and reset locally saved allow/block decisions.", PageBody(toolbar, list));
    }

    private Task ShowAboutAsync()
    {
        var body = new StackPanel { Spacing = 12, MaxWidth = 620 };
        body.Children.Add(new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri("ms-appx:///Assets/sutra-icon.png")), Width = 72, Height = 72, HorizontalAlignment = HorizontalAlignment.Left });
        body.Children.Add(new TextBlock { Text = $"{Browser.Core.Branding.AppBrand.Name} {Browser.Core.Branding.AppBrand.Version}", FontSize = 22, FontWeight = FontWeights.SemiBold });
        body.Children.Add(new TextBlock { Text = "A focused Windows browser built with WinUI 3, WebView2, C#, and SQLite.", TextWrapping = TextWrapping.Wrap });
        body.Children.Add(new TextBlock { Text = "Browser data stays local. Page text is shared with an AI provider only after you invoke Copilot. Private windows use WebView2 InPrivate mode and do not write history or sessions.", TextWrapping = TextWrapping.Wrap, Opacity = .72 });
        body.Children.Add(new TextBlock { Text = "The current build is unpackaged and uses the Evergreen WebView2 Runtime.", TextWrapping = TextWrapping.Wrap, Opacity = .72 });
        ShowPage("About", "Application and privacy information.", body);
        return Task.CompletedTask;
    }

    private void ShowPage(string title, string subtitle, FrameworkElement body, params Button[] actions)
        => ShowPage(title, subtitle, body, onClosed: null, actions);

    private void ShowPage(string title, string subtitle, FrameworkElement body, Action? onClosed, params Button[] actions)
    {
        var page = new Grid { Padding = new(28, 22, 28, 24), RowSpacing = 16 };
        page.RowDefinitions.Add(new() { Height = GridLength.Auto }); page.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); page.RowDefinitions.Add(new() { Height = actions.Length == 0 ? new(0) : GridLength.Auto });
        var header = new Grid(); header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var heading = new StackPanel { Spacing = 3 }; heading.Children.Add(new TextBlock { Text = title, FontSize = 24, FontWeight = FontWeights.SemiBold }); heading.Children.Add(new TextBlock { Text = subtitle, Opacity = .62, TextWrapping = TextWrapping.Wrap }); header.Children.Add(heading);
        var close = IconButton(Symbol.Cancel, "Close"); close.Click += (_, _) => HidePage(); Grid.SetColumn(close, 1); header.Children.Add(close); page.Children.Add(header);
        Grid.SetRow(body, 1); page.Children.Add(body);
        if (actions.Length > 0) { var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right }; foreach (var action in actions) actionRow.Children.Add(action); Grid.SetRow(actionRow, 2); page.Children.Add(actionRow); }
        // Large browser-owned surfaces behave as real, transient tabs. Reuse a
        // page's tab when it is already open, just like a browser settings tab.
        // The page visual is still native WinUI, but is only visible for its tab.
        var pageKey = string.Concat(title.Where(char.IsLetterOrDigit)).ToLowerInvariant();
        var pageUrl = "sutra://page/" + pageKey;
        var managerTab = _vm.Tabs.FirstOrDefault(tab => IsNativePageTab(tab) && tab.Url.Equals(pageUrl, StringComparison.OrdinalIgnoreCase));
        if (managerTab is not null)
        {
            // The previous page instance on this tab is being replaced: retire its
            // lifecycle callback first so it can never update a detached visual.
            if (_nativePageClosedHandlers.Remove(managerTab.Id, out var priorClosed)) priorClosed();
            _nativePageClosedHandlers[managerTab.Id] = onClosed ?? (() => { });
            _nativePageTabs[managerTab.Id] = page;
            _vm.SelectedTab = managerTab;
            ShowNativePageVisual(page);
            _address.Text = pageUrl;
            RefreshTabLists();
            return;
        }

        managerTab = new BrowserTab { Url = pageUrl, Title = title };
        _nativePageTabs[managerTab.Id] = page;
        if (onClosed is not null) _nativePageClosedHandlers[managerTab.Id] = onClosed;
        _vm.Add(managerTab, activate: false);
        RefreshTabLists();
        _ = ActivateTabAsync(managerTab);
    }

    private void HidePage()
    {
        if (_vm.SelectedTab is { } selected && IsNativePageTab(selected))
        {
            CloseTab(selected);
            return;
        }
        HideNativePageVisual();
    }

    private bool IsNativePageTab(BrowserTab tab) => _nativePageTabs.ContainsKey(tab.Id);

    private void ShowNativePageVisual(FrameworkElement page)
    {
        // WebView2 is rendered on a composed surface. Hide it only while its own
        // manager tab is selected, preventing visual bleed-through/click interception.
        _browserHost.Visibility = Visibility.Collapsed;
        _pageOverlay.Background = ManagerPageBackground();
        _pageOverlay.Child = page;
        _pageOverlay.Visibility = Visibility.Visible;
    }

    private void HideNativePageVisual()
    {
        _pageOverlay.Visibility = Visibility.Collapsed;
        _pageOverlay.Child = null;
        _browserHost.Visibility = Visibility.Visible;
    }

    private Brush ManagerPageBackground()
    {
        var isLight = _root.ActualTheme == ElementTheme.Light;
        return new SolidColorBrush(isLight
            ? Windows.UI.Color.FromArgb(255, 243, 243, 243)
            : Windows.UI.Color.FromArgb(255, 32, 32, 32));
    }

    private static Grid PageBody(FrameworkElement toolbar, FrameworkElement content)
    {
        var body = new Grid { RowSpacing = 12 }; body.RowDefinitions.Add(new() { Height = GridLength.Auto }); body.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        body.Children.Add(new ScrollViewer{Content=toolbar,HorizontalScrollMode=ScrollMode.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Hidden});Grid.SetRow(content, 1); body.Children.Add(content); return body;
    }

    private static StackPanel ManagerRow(string title, string detail)
    {
        var row = new StackPanel { Spacing = 3, Padding = new(6, 8, 6, 8) }; row.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis }); row.Children.Add(new TextBlock { Text = detail, FontSize = 12, Opacity = .6, TextWrapping = TextWrapping.Wrap }); return row;
    }

    private static Button ActionButton(string text, Symbol symbol, Action action)
    {
        var button = new Button { Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new SymbolIcon(symbol), new TextBlock { Text = text } } }, CornerRadius = new(8) };
        button.Click += (_, _) => action(); return button;
    }

    private static Border SettingsSection(string title, string description, params UIElement[] controls)
    {
        var stack = new StackPanel { Spacing = 10 }; stack.Children.Add(new TextBlock { Text = title, FontSize = 17, FontWeight = FontWeights.SemiBold }); stack.Children.Add(new TextBlock { Text = description, Opacity = .62, TextWrapping = TextWrapping.Wrap }); foreach (var control in controls) stack.Children.Add(control);
        return new Border { Child = stack, Padding = new(18), CornerRadius = new(10), BorderThickness = new(1), BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush"), Background = ResourceBrush("CardBackgroundFillColorDefaultBrush") };
    }

    private static FrameworkElement EmptyState(Symbol symbol, string message)
    {
        var panel = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }; panel.Children.Add(new SymbolIcon(symbol) { Width = 40, Height = 40, Opacity = .5 }); panel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, MaxWidth = 440, TextAlignment = TextAlignment.Center, Opacity = .7 }); return panel;
    }

    private async Task<bool> ConfirmAsync(string title, string message, string action)
    {
        var dialog = new ContentDialog { Title = title, Content = message, PrimaryButtonText = action, CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close, XamlRoot = _root.XamlRoot };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    private async Task NoticeAsync(string title, string message) => await new ContentDialog { Title = title, Content = message, CloseButtonText = "OK", XamlRoot = _root.XamlRoot }.ShowAsync();
    private static void SetClipboard(string text) { var package = new DataPackage(); package.SetText(text); Clipboard.SetContent(package); Clipboard.Flush(); }
    private void ScheduleClipboardClear(string expected) { var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) }; timer.Tick += async (_, _) => { timer.Stop(); try { var view = Clipboard.GetContent(); if (view.Contains(StandardDataFormats.Text) && await view.GetTextAsync() == expected) Clipboard.Clear(); } catch { } }; timer.Start(); }
}
