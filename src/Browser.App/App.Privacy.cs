using Browser.Core.Privacy;
using Browser.Core.Profiles;
using Browser.Data;
using Browser.Data.Repositories;
using Browser.Platform.Windows.Storage;
using Browser.Platform.Windows.WebView;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public partial class App
{
    private KillSwitchService? _killSwitch;
    private WebViewEnvironmentManager? _privacyEnvironment;
    private BrowserPaths? _privacyPaths;
    private DispatcherQueue? _uiQueue;
    private DispatcherTimer? _privacyTimer;
    private IDisposable? _instanceLease;
    private long _privacyRevision;
    private bool _privacyPollRunning;
    private bool _killSwitchStarted;
    private bool _killSwitchRunning;
    private bool _killRequestRecorded;
    private Window? _privacyHost;
    private Window? _privacyError;

    private async Task<bool> InitializePrivacyAsync(BrowserPaths paths, IReadOnlyList<string> arguments)
    {
        _privacyPaths = paths;
        _uiQueue = DispatcherQueue.GetForCurrentThread();
        _killSwitch = new(paths);
        _privacyEnvironment = new(paths);
        if (KillSwitchPolicy.IsLaunchRequested(arguments)) { await RunKillSwitchAsync(); return false; }
        try
        {
            _privacyRevision = await Task.Run(() => _killSwitch.CompletePendingAsync(ClearEngineHistoryOnUiAsync));
            return true;
        }
        catch (Exception ex)
        {
            _killSwitchStarted = true;
            _killRequestRecorded = true;
            ShowPrivacyFailure(ex);
            return false;
        }
    }

    private void StartPrivacyMonitor()
    {
        _privacyTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _privacyTimer.Tick += async (_, _) =>
        {
            if (_privacyPollRunning || _killSwitchStarted) return;
            _privacyPollRunning = true;
            try
            {
                var request = await Task.Run(() => _killSwitch!.ReadRequest());
                if (request > _privacyRevision) await RunKillSwitchAsync(createRequest: false);
            }
            catch (Exception ex)
            {
                // A broken marker must not silently disable an emergency request.
                PreparePrivacyShutdown();
                ShowPrivacyFailure(ex);
            }
            finally { _privacyPollRunning = false; }
        };
        _privacyTimer.Start();
    }

    internal async Task RunKillSwitchAsync(bool createRequest = true)
    {
        if (_killSwitchRunning) return;
        _killSwitchRunning = true;
        try
        {
            PreparePrivacyShutdown();
            if (createRequest && !_killRequestRecorded)
                await Task.Run(() => _killSwitch!.RequestAsync());
            _killRequestRecorded = true;
            await Task.Run(() => _killSwitch!.CompletePendingAsync(ClearEngineHistoryOnUiAsync));
            foreach (var window in BrowserWindows) await window.DrainPrivacyShutdownAsync();
            foreach (var window in _windows.ToArray()) window.Close();
            _privacyError?.Close(); _privacyError = null;
            _privacyHost?.Close(); _privacyHost = null;
            Exit();
        }
        catch (Exception ex) { ShowPrivacyFailure(ex); }
        finally { _killSwitchRunning = false; }
    }

    private void PreparePrivacyShutdown()
    {
        _killSwitchStarted = true;
        _privacyTimer?.Stop();
        // Hide every surface before doing any asynchronous or disk work.
        foreach (var window in _windows.ToArray()) { try { window.AppWindow.Hide(); } catch { } }
        foreach (var window in _windows.ToArray())
        {
            if (window is MainWindow browser) browser.PreparePrivacyShutdown();
            else if (window is AuthenticationWindow authentication) authentication.PreparePrivacyShutdown();
        }
        // Other processes wait for this lease before clearing engine history.
        // Release it only after all this process's page controllers are closed.
        _instanceLease?.Dispose(); _instanceLease = null;
    }

    private Task ClearEngineHistoryOnUiAsync(CancellationToken ct)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_uiQueue!.TryEnqueue(async () =>
        {
            try { await ClearEngineHistoryAsync(ct); completion.TrySetResult(); }
            catch (Exception ex) { completion.TrySetException(ex); }
        })) completion.TrySetException(new InvalidOperationException("Browser UI is unavailable for privacy cleanup."));
        return completion.Task;
    }

    private async Task ClearEngineHistoryAsync(CancellationToken ct)
    {
        if (!Directory.Exists(_privacyPaths!.WebViewProfilePath)) return;
        _privacyHost ??= new Window { Title = "Sutra — clearing local history" };
        var handle = WinRT.Interop.WindowNative.GetWindowHandle(_privacyHost);
        var database = new BrowserDatabase(_privacyPaths.DatabasePath);
        await database.InitializeAsync(ct);
        var names = await new ProfileDirectoryRepository(database).ListAsync(ct);
        var environment = await _privacyEnvironment!.GetAsync();
        foreach (var name in names)
        {
            ct.ThrowIfCancellationRequested();
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.ProfileName = name == "Default" ? "Default" : ProfileIdentity.WebViewName(name);
            var parent = CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)handle);
            var controller = await environment.CreateCoreWebView2ControllerAsync(parent, options);
            try
            {
                controller.IsVisible = false;
                await controller.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.BrowsingHistory);
            }
            finally { controller.Close(); }
        }
    }

    private void ShowPrivacyFailure(Exception exception)
    {
        System.Diagnostics.Debug.WriteLine($"Privacy cleanup incomplete: {exception.GetType().Name}");
        if (_privacyError is not null) { _privacyError.Activate(); return; }
        var retry = new Button { Content = "Retry cleanup" };
        retry.Click += async (_, _) =>
        {
            retry.IsEnabled = false;
            await RunKillSwitchAsync(createRequest: !_killRequestRecorded);
            retry.IsEnabled = true;
        };
        _privacyError = new Window { Title = "Sutra — history cleanup incomplete", Content = new StackPanel
        {
            Margin = new(32), Spacing = 16, Children =
            {
                new TextBlock { Text = "History cleanup needs another attempt", FontSize = 22, TextWrapping = TextWrapping.Wrap },
                new TextBlock { Text = "Browsing is closed in this process. Local history cleanup could not finish. Close any older or unresponsive Sutra processes, then retry. A recorded request will also be retried before the next launch opens tabs.", TextWrapping = TextWrapping.Wrap },
                retry
            }
        } };
        _privacyError.Closed += (_, _) => Exit();
        _privacyError.Activate();
    }
}
