namespace Browser.App;

public sealed partial class MainWindow
{
    private bool _suppressPersistence;
    private readonly TaskCompletionSource _shutdownCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal Task ShutdownCompleted => _shutdownCompleted.Task;

    internal void PreparePrivacyShutdown()
    {
        _suppressPersistence = true;
        _isWindowClosed = true;
        _allowClose = true;
        _ready.TrySetResult(false);
        try { _aiCancellation?.Cancel(); } catch { }
        try { _windowLifetimeCts.Cancel(); } catch { }
        StopTimer(_maintenanceTimer); StopTimer(_notificationTimer); StopTimer(_mediaTimer); StopTimer(_tabSwitcherTimer);
        foreach (var operation in _activeDownloads.Values.Concat(_resumableDownloads.Values).Distinct().ToList())
            try { operation.Cancel(); } catch { }
        _pausedDownloads.Clear();
        try { CloseWebPanel(); } catch { }
        foreach (var tab in _vm.Tabs.ToList()) { try { CloseMiniPlayersForTab(tab.Id); } catch { } }
        CloseAllTabWebViews();
        _vm.RecentlyClosed.Clear();
        _previousSession = null;
        _pendingTypedQuery = null;
        _vm.SelectedTab = null;
        _vm.Tabs.Clear();
        _splitTabIds.Clear();
        _splitColumnFractions = null;
        _splitRowFractions = null;
        _tabGroups.Clear();
    }

    internal async Task DrainPrivacyShutdownAsync()
    {
        await DrainBackgroundWorkQuietlyAsync(_maintenanceWork);
        await DrainBackgroundWorkQuietlyAsync(_mediaRefreshWork);
        await _persistenceSaves.DrainAsync();
    }
}
