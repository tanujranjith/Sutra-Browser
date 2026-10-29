using Browser.Core.Bookmarks;
using Browser.Data.Models;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task ReviewBookmarkDuplicatesAsync()
    {
        if (_isPrivate) { ShowStatus("Review bookmark duplicates in a normal window."); return; }
        var bookmarks = new List<Bookmark>();
        for (var offset = 0; offset < 10000; offset += 200)
        {
            var page = await _bookmarks.SearchPagedAsync("", offset, 200, _windowLifetimeCts.Token);
            bookmarks.AddRange(page); if (page.Count < 200) break;
        }
        var ids = BookmarkMaintenancePolicy.DuplicateIds(bookmarks.Select(item => new BookmarkIdentity(item.Id, item.FolderId, item.Url))).ToHashSet();
        if (ids.Count == 0) { ShowStatus("No exact duplicate bookmarks found within the same folder."); return; }
        var list = new ListView { SelectionMode = ListViewSelectionMode.Multiple, MaxHeight = 360, MinWidth = 280 };
        foreach (var item in bookmarks.Where(item => ids.Contains(item.Id)))
        {
            var row = new ListViewItem { Tag = item, Content = ManagerRow(item.Title, item.Url) }; list.Items.Add(row); list.SelectedItems.Add(row);
        }
        var dialog = new ContentDialog { Title = "Review duplicate bookmarks", Content = new Microsoft.UI.Xaml.Controls.StackPanel { Spacing = 12, Children = {
            new TextBlock { Text = "Exact copies in the same folder only. At least one copy stays. Different folders, address case, query strings, and fragments are preserved. Review up to 200 removals at a time.", TextWrapping = Microsoft.UI.Xaml.TextWrapping.Wrap }, list } }, PrimaryButtonText = "Remove selected copies", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close, XamlRoot = _root.XamlRoot };
        list.SelectionChanged += (_, _) => dialog.IsPrimaryButtonEnabled = list.SelectedItems.Count > 0;
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || _isWindowClosed) return;
        var removed = await _bookmarks.DeleteReviewedDuplicatesAsync(list.SelectedItems.OfType<ListViewItem>().Select(item => (Bookmark)item.Tag), _windowLifetimeCts.Token);
        await RefreshBookmarkBarAsync();
        if (removed.Count == 0) { ShowStatus("No bookmarks removed. The reviewed copies changed or no longer have duplicates."); return; }
        ShowUndoStatus($"Removed {removed.Count} duplicate bookmarks", async () =>
        {
            var restored = await _bookmarks.RestoreRemovedAsync(removed, _windowLifetimeCts.Token);
            await RefreshBookmarkBarAsync(); ShowStatus($"Restored {restored} bookmarks", InfoBarSeverity.Success);
        });
    }
}
