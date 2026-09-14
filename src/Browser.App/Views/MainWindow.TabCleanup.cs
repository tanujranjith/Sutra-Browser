using Browser.Core.Tabs;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private string? CleanupSleepReason(BrowserTab tab) => TabCleanupPolicy.SleepBlockReason(tab, _vm.SelectedTab?.Id,
        _splitTabIds.Contains(tab.Id), IsInNeverHibernateGroup(tab), HasMiniPlayerForTab(tab.Id), _webViews.ContainsKey(tab.Id), _vm.Settings.HibernationExclusions);

    private async Task<IReadOnlyList<BrowserTab>> PreviewTabCleanupAsync(string title, string explanation, IReadOnlyList<BrowserTab> tabs,
        string action, Func<BrowserTab, string?> blockReason)
    {
        var list = new ListView { SelectionMode = ListViewSelectionMode.Multiple, MaxHeight = 420, MinWidth = 280 };
        var count = new TextBlock { TextWrapping = TextWrapping.Wrap };
        foreach (var tab in tabs)
        {
            var reason = blockReason(tab);
            var item = new ListViewItem { Tag = tab, IsEnabled = reason is null,
                Content = ManagerRow(tab.Title, $"{(reason is null ? "Ready for cleanup" : "Keep: " + reason)} · {tab.Url}") };
            list.Items.Add(item);
            if (reason is null) list.SelectedItems.Add(item);
        }
        var body = new StackPanel { Spacing = 12, Children =
        {
            new TextBlock { Text = explanation, TextWrapping = TextWrapping.Wrap }, count, list
        } };
        var dialog = new ContentDialog { Title = title, Content = body, PrimaryButtonText = action, CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close, XamlRoot = _root.XamlRoot };
        void Update()
        {
            count.Text = $"{list.SelectedItems.Count} selected · {tabs.Count} reviewed";
            dialog.IsPrimaryButtonEnabled = list.SelectedItems.Count > 0;
        }
        list.SelectionChanged += (_, _) => Update(); Update();
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || _isWindowClosed) return [];
        return list.SelectedItems.Cast<ListViewItem>().Select(item => (BrowserTab)item.Tag).ToArray();
    }

    private async Task PreviewDuplicateCleanupAsync()
    {
        HashSet<Guid> ProtectedIds() => _vm.Tabs.Where(tab => IsNativePageTab(tab) || _splitTabIds.Contains(tab.Id) || HasMiniPlayerForTab(tab.Id)).Select(tab => tab.Id).ToHashSet();
        var candidates = TabCleanupPolicy.DuplicateCandidates(_vm.Tabs, _vm.SelectedTab?.Id, ProtectedIds());
        if (candidates.Count == 0) { ShowStatus("No unprotected duplicate tabs found"); return; }
        var urls = candidates.ToDictionary(tab => tab.Id, tab => tab.Url);
        var selected = await PreviewTabCleanupAsync("Review duplicate tabs", "Select the duplicate tabs to close. At least one copy of each address stays open. Closed tabs can be reopened with Ctrl+Shift+T.", candidates, "Close selected", _ => null);
        var closed = 0;
        foreach (var tab in selected)
        {
            if (_isWindowClosed) return;
            if (tab.Url != urls[tab.Id] || !TabCleanupPolicy.DuplicateCandidates(_vm.Tabs, _vm.SelectedTab?.Id, ProtectedIds()).Contains(tab)) continue;
            CloseTab(tab); closed++;
        }
        if (closed > 0) ShowStatus($"Closed {closed} duplicate tabs. Ctrl+Shift+T reopens a closed tab.", InfoBarSeverity.Success);
    }
}
