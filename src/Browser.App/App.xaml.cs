using Browser.AI.Providers;
using Browser.Core.BrowserEngine;
using Browser.Core.Passwords;
using Browser.Data;
using Browser.Data.Repositories;
using Browser.Platform.Windows.Security;
using Browser.Platform.Windows.Storage;
using Browser.Platform.Windows.Cef;
using Browser.Platform.Windows.WebView;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;
    private readonly List<Window> _windows = [];
    private bool _browserEngineDisposed;
    private ProfileLibraries? _profileLibraries;
    internal IEnumerable<MainWindow> BrowserWindows => _windows.OfType<MainWindow>().ToArray();

    public App()
    {
        InitializeComponent();
        // Global policy: only cancellation-style exceptions are contained — they
        // are normal shutdown/teardown artifacts, not corruption. Any other
        // unhandled UI exception is recorded safely (type only) and deliberately
        // left unhandled so WinUI terminates the process; the next launch then
        // shows the truthful crash-recovery notice instead of continuing in an
        // unknown state. Raw exception text, paths, and secrets are never shown.
        UnhandledException += (_, e) =>
        {
            if (e.Exception is OperationCanceledException)
            {
                System.Diagnostics.Debug.WriteLine($"Contained cancellation during UI callback: {e.Exception.GetType().Name}");
                e.Handled = true;
                return;
            }
            System.Diagnostics.Debug.WriteLine($"Unhandled UI exception ({e.Exception.GetType().Name}); allowing termination for crash recovery.");
            e.Handled = false;
        };
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            var paths = new BrowserPaths();
            var launchArguments = Environment.GetCommandLineArgs().Skip(1).ToList();
            if (!await InitializePrivacyAsync(paths, launchArguments)) return;
            var services = new ServiceCollection();
            services.AddSingleton(paths);
            services.AddSingleton(new BrowserDatabase(paths.DatabasePath, _privacyRevision));
            services.AddSingleton<AppStateRepository>(); services.AddSingleton<SettingsRepository>(); services.AddSingleton<SessionRepository>();
            services.AddSingleton<HistoryRepository>(); services.AddSingleton<BookmarkRepository>(); services.AddSingleton<DownloadRepository>();
            services.AddSingleton<WorkspaceRepository>(); services.AddSingleton<ReadingListRepository>(); services.AddSingleton<PageNoteRepository>();
            services.AddSingleton<OfflineArticleRepository>();
            services.AddSingleton<SessionSnapshotRepository>();
            services.AddSingleton<WindowSessionRepository>();
            services.AddSingleton<ProfileDirectoryRepository>();
            services.AddSingleton<PasswordMetadataRepository>(); services.AddSingleton<PermissionRepository>(); services.AddSingleton<AiActionLogRepository>();
            services.AddSingleton<ISecureCredentialStore>(_ => new DpapiCredentialStore(paths.CredentialPath));
            services.AddSingleton<CredentialService>(); services.AddSingleton(_privacyEnvironment!); services.AddHttpClient();
            services.AddSingleton<CefRuntimeLayout>();
            services.AddSingleton<IBrowserEngine, CefBrowserEngine>();
            Services = services.BuildServiceProvider();
            await Services.GetRequiredService<BrowserDatabase>().InitializeAsync();
            if (_privacyRevision > 0)
                await new KillSwitchRepository(Services.GetRequiredService<BrowserDatabase>()).ClearAsync(_privacyRevision);
            try { _instanceLease = await _killSwitch!.RegisterInstanceAsync(_privacyRevision); }
            catch (OperationCanceledException) { await RunKillSwitchAsync(createRequest: false); return; }
            StartPrivacyMonitor();
            var privateLaunch = launchArguments.Any(x => x.Equals("--private", StringComparison.OrdinalIgnoreCase));
            var initialUrl = launchArguments.FirstOrDefault(x => Uri.TryCreate(x, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https");
            await OpenInitialWindowsAsync(privateLaunch, initialUrl);
        }
        catch (Exception ex)
        {
            // Never leak raw exception text on the startup screen: messages can
            // contain local file paths or provider details. Log the type for
            // diagnostics and show an actionable summary instead.
            System.Diagnostics.Debug.WriteLine($"Sutra startup failed: {ex.GetType().Name}");
            var window = new Window { Title = "Sutra Browser — startup error", Content = new Microsoft.UI.Xaml.Controls.StackPanel { Margin = new(32), Children = {
                new Microsoft.UI.Xaml.Controls.TextBlock { Text = "Sutra Browser could not start.", FontSize = 18, TextWrapping = TextWrapping.Wrap },
                new Microsoft.UI.Xaml.Controls.TextBlock { Text = "Local browser data could not be opened, or the browser engine failed to initialize.\nClose Sutra completely and try again. If this keeps happening, close all Sutra windows and delete the browser data folder only if you accept losing local history, bookmarks, and saved passwords.", Margin = new(0, 12, 0, 0), TextWrapping = TextWrapping.Wrap },
                new Microsoft.UI.Xaml.Controls.TextBlock { Text = $"Diagnostic code: {ex.GetType().Name}", Margin = new(0, 12, 0, 0), Opacity = .6 }
            } } };
            TrackAndActivate(window);
        }
    }

    internal void OpenWindow(bool isPrivate = false, string? initialUrl = null, bool restoreSession = true, string profileName = "Default")
    {
        _ = OpenPreparedWindowAsync(isPrivate, initialUrl, restoreSession, profileName);
    }

    /// <summary>
    /// Automatic restoration of all normal windows (#2). The first launch opens the most
    /// recent window normally (preserving crash-loop protection and single-window settings);
    /// additional saved windows open with explicit sessions. Private launches, explicit URLs,
    /// and crash-review starts never auto-restore. Failures fall back to a single window.
    /// </summary>
    internal async Task OpenInitialWindowsAsync(bool isPrivate, string? initialUrl)
    {
        if (isPrivate || initialUrl is not null)
        {
            OpenWindow(isPrivate, initialUrl, initialUrl is null);
            return;
        }
        try
        {
            _profileLibraries ??= new ProfileLibraries(Services);
            var settings = await Services.GetRequiredService<SettingsRepository>().LoadAsync();
            if (settings.StartupBehavior != Browser.Core.Settings.StartupBehavior.RestorePreviousSession)
            {
                OpenWindow(false, null, true);
                return;
            }
            var appState = Services.GetRequiredService<AppStateRepository>();
            var clean = await appState.GetAsync("browser.cleanShutdown");
            var recovery = Browser.Core.Sessions.StartupRecoveryPolicy.Begin(
                await appState.GetAsync(Browser.Core.Sessions.StartupRecoveryPolicy.StorageKey),
                clean != "false", DateTimeOffset.UtcNow);
            if (recovery.NeedsReview)
            {
                OpenWindow(false, null, true);
                return;
            }
            // Default profile windows live in the default database; other profiles are best-effort.
            var profiles = new List<string> { "Default" };
            try { profiles = (await Services.GetRequiredService<ProfileDirectoryRepository>().ListAsync()).Take(8).ToList(); }
            catch { }
            var saved = new List<Browser.Core.Sessions.MultiWindowSessionPolicy.SavedWindow>();
            foreach (var profile in profiles)
            {
                try
                {
                    var data = await _profileLibraries.GetAsync(profile);
                    var windows = await data.GetRequiredService<WindowSessionRepository>().ListForProfileAsync(profile);
                    saved.AddRange(windows);
                }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Multi-window list failed: {ex.GetType().Name}"); }
            }
            if (saved.Count == 0)
            {
                OpenWindow(false, null, true);
                return;
            }
            // Newest first, bounded. The newest window becomes the initial window via the normal
            // single-session path (so legacy browser.session stays coherent); the rest open explicitly.
            var ordered = saved.OrderByDescending(w => w.SavedAt).Take(Browser.Core.Sessions.MultiWindowSessionPolicy.MaximumWindowsToRestore).ToList();
            var first = ordered[0];
            var firstWindow = await OpenPreparedWindowAsync(false, null, true, first.ProfileName,
                Browser.Core.Sessions.MultiWindowSessionPolicy.WithoutTemporary(first.Session));
            if (firstWindow is null) { OpenWindow(false, null, true); return; }
            foreach (var extra in ordered.Skip(1))
            {
                if (_killSwitchStarted) break;
                try { await OpenPreparedWindowAsync(false, null, false, extra.ProfileName, Browser.Core.Sessions.MultiWindowSessionPolicy.WithoutTemporary(extra.Session)); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Extra window restore failed: {ex.GetType().Name}"); }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Multi-window restore fallback: {ex.GetType().Name}");
            OpenWindow(false, null, true);
        }
    }

    internal void OpenSessionWindow(Browser.Core.Sessions.BrowserSession session, string profileName)
        => _ = OpenPreparedWindowAsync(false, null, false, profileName, Browser.Core.Workspaces.WorkspacePolicy.Instantiate(session));

    internal async Task<MainWindow?> OpenPreparedWindowAsync(bool isPrivate, string? initialUrl, bool restoreSession, string profileName, Browser.Core.Sessions.BrowserSession? session = null)
    {
        if (_killSwitchStarted) return null;
        try
        {
            _profileLibraries ??= new ProfileLibraries(Services);
            var data = await _profileLibraries.GetAsync(isPrivate ? "Default" : profileName);
            if (_killSwitchStarted) return null;
            var window = new MainWindow(isPrivate, initialUrl, restoreSession, profileName, session, data);
            TrackAndActivate(window);
            return window;
        }
        catch (Exception ex)
        {
            if (_killSwitchStarted) return null;
            System.Diagnostics.Debug.WriteLine($"Profile initialization: {ex.GetType().Name}");
            TrackAndActivate(new Window { Title = "Sutra — profile unavailable", Content = new Microsoft.UI.Xaml.Controls.TextBlock
            { Text = "This profile could not be opened. Close Sutra and try again. Your existing browser data has not been removed.", TextWrapping = TextWrapping.Wrap, Margin = new(32) } });
            return null;
        }
    }

    internal void OpenAuthenticationWindow(bool isPrivate, string initialUrl, string profileName)
    {
        if (_killSwitchStarted) return;
        TrackAndActivate(new AuthenticationWindow(isPrivate, initialUrl, profileName));
    }

    internal async Task OpenAuthenticationPopupAsync(bool isPrivate, string initialUrl, string profileName, CoreWebView2NewWindowRequestedEventArgs request)
    {
        if (_killSwitchStarted) { request.Handled = true; return; }
        var window = new AuthenticationWindow(isPrivate, initialUrl, profileName, isPopup: true);
        TrackAndActivate(window);
        await window.AttachPopupAsync(request);
    }

    private void TrackAndActivate(Window window)
    {
        if (_killSwitchStarted) { window.Close(); return; }
        _windows.Add(window);
        window.Closed += async (_, _) =>
        {
            if (window is MainWindow browser) await browser.ShutdownCompleted;
            _windows.Remove(window);
            if (_windows.Count == 0 && !_browserEngineDisposed && Services is not null)
            {
                _privacyTimer?.Stop();
                _instanceLease?.Dispose(); _instanceLease = null;
                _browserEngineDisposed = true;
                try { await Services.GetRequiredService<IBrowserEngine>().DisposeAsync(); }
                catch (Exception exception) { System.Diagnostics.Debug.WriteLine($"Engine shutdown: {exception.GetType().Name}"); }
            }
        };
        window.Activate();
        _privacyHost?.Close(); _privacyHost = null;
    }
}
