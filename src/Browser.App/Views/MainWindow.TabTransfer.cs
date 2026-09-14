using Browser.Core.Tabs;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private IEnumerable<MainWindow> TabTransferTargets() => ((App)Application.Current).BrowserWindows
        .Where(window => window != this && !window._isWindowClosed && window._isPrivate == _isPrivate && window._profileName.Equals(_profileName, StringComparison.OrdinalIgnoreCase));

    private MenuFlyoutSubItem BuildWindowTransferMenu(BrowserTab tab)
    {
        var menu = new MenuFlyoutSubItem { Text = "Move to existing window" };
        foreach (var window in TabTransferTargets())
        {
            var item = new MenuFlyoutItem { Text = $"{window._profileName} · {window._vm.SelectedTab?.Title ?? "New window"} · {window._vm.Tabs.Count} tabs" };
            item.Click += async (_, _) => await MoveTabToWindowAsync(tab, window);
            menu.Items.Add(item);
        }
        menu.IsEnabled = menu.Items.Count > 0;
        return menu;
    }

    private async Task<BrowserTab?> MoveTabToWindowAsync(BrowserTab tab, MainWindow target)
    {
        var check = TabTransferPolicy.CanTransfer(tab, IsNativePageTab(tab), _profileName, _isPrivate, target._profileName, target._isPrivate);
        if (!check.Allowed) { ShowStatus(check.Reason); return null; }
        if (_isWindowClosed || target._isWindowClosed || !_vm.Tabs.Contains(tab)) return null;
        try
        {
            if (!await target._ready.Task.WaitAsync(TimeSpan.FromSeconds(20), _windowLifetimeCts.Token) || target._isWindowClosed) return null;
            check = TabTransferPolicy.CanTransfer(tab, IsNativePageTab(tab), _profileName, _isPrivate, target._profileName, target._isPrivate);
            if (!check.Allowed || !_vm.Tabs.Contains(tab)) { ShowStatus(check.Reason); return null; }
            var sourceUrl = tab.Url;
            if (_webViews.TryGetValue(tab.Id, out var sourceView))
            {
                var scroll = await sourceView.ExecuteScriptAsync("Number.isFinite(window.scrollY)?window.scrollY:0").AsTask().WaitAsync(TimeSpan.FromSeconds(3), _windowLifetimeCts.Token);
                if (double.TryParse(scroll, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var offset)) tab.ScrollPosition = Math.Max(0, offset);
            }
            if (tab.Url != sourceUrl) return null;
            check = TabTransferPolicy.CanTransfer(tab, IsNativePageTab(tab), _profileName, _isPrivate, target._profileName, target._isPrivate);
            if (!check.Allowed) { ShowStatus(check.Reason); return null; }
            // Tree parents stay behind: the moved tab becomes a root in the target window.
            // Source children are orphaned by CloseTab so no tab is lost.
            var copy = BrowserTab.FromSnapshot(tab.ToSnapshot() with { Id = Guid.NewGuid(), ParentId = null, IsTreeCollapsed = false, FaviconPath = _isPrivate ? null : tab.FaviconPath });
            if (copy.GroupId is { } groupId && !target._tabGroups.ContainsKey(groupId) && _tabGroups.TryGetValue(groupId, out var group))
                target._tabGroups[groupId] = TabGroup.FromSnapshot(group.ToSnapshot());
            target._vm.Add(copy, false);
            try { await target.ActivateTabAsync(copy); }
            catch { target.CloseTab(copy); throw; }
            if (_isWindowClosed || target._isWindowClosed) return copy;
            check = TabTransferPolicy.CanTransfer(tab, IsNativePageTab(tab), _profileName, _isPrivate, target._profileName, target._isPrivate);
            if (!check.Allowed || tab.Url != sourceUrl) return copy;
            CloseTab(tab);
            target.Activate();
            target.ShowStatus("Tab moved here", InfoBarSeverity.Success);
            return copy;
        }
        catch (OperationCanceledException) { return null; }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Tab transfer: {ex.GetType().Name}"); if (!_isWindowClosed) ShowStatus("The tab could not be moved. Its source remains open.", InfoBarSeverity.Warning); return null; }
    }
}
