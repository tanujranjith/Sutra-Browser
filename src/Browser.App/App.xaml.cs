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
            var services = new ServiceCollection();
            services.AddSingleton(paths);
            services.AddSingleton(new BrowserDatabase(paths.DatabasePath));
            services.AddSingleton<AppStateRepository>(); services.AddSingleton<SettingsRepository>(); services.AddSingleton<SessionRepository>();
            services.AddSingleton<HistoryRepository>(); services.AddSingleton<BookmarkRepository>(); services.AddSingleton<DownloadRepository>();
            services.AddSingleton<WorkspaceRepository>(); services.AddSingleton<ReadingListRepository>(); services.AddSingleton<PageNoteRepository>();
            services.AddSingleton<PasswordMetadataRepository>(); services.AddSingleton<PermissionRepository>(); services.AddSingleton<AiActionLogRepository>();
            services.AddSingleton<ISecureCredentialStore>(_ => new DpapiCredentialStore(paths.CredentialPath));
            services.AddSingleton<CredentialService>(); services.AddSingleton<WebViewEnvironmentManager>(); services.AddHttpClient();
            services.AddSingleton<CefRuntimeLayout>();
            services.AddSingleton<IBrowserEngine, CefBrowserEngine>();
            Services = services.BuildServiceProvider();
            await Services.GetRequiredService<BrowserDatabase>().InitializeAsync();
            var launchArguments = Environment.GetCommandLineArgs().Skip(1).ToList();
            var privateLaunch = launchArguments.Any(x => x.Equals("--private", StringComparison.OrdinalIgnoreCase));
            var initialUrl = launchArguments.FirstOrDefault(x => Uri.TryCreate(x, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https");
            OpenWindow(privateLaunch, initialUrl, initialUrl is null);
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
        TrackAndActivate(new MainWindow(isPrivate, initialUrl, restoreSession, profileName));
    }

    internal void OpenAuthenticationWindow(bool isPrivate, string initialUrl, string profileName)
    {
        TrackAndActivate(new AuthenticationWindow(isPrivate, initialUrl, profileName));
    }

    internal async Task OpenAuthenticationPopupAsync(bool isPrivate, string initialUrl, string profileName, CoreWebView2NewWindowRequestedEventArgs request)
    {
        var window = new AuthenticationWindow(isPrivate, initialUrl, profileName, isPopup: true);
        TrackAndActivate(window);
        await window.AttachPopupAsync(request);
    }

    private void TrackAndActivate(Window window)
    {
        _windows.Add(window);
        window.Closed += async (_, _) =>
        {
            _windows.Remove(window);
            if (_windows.Count == 0 && !_browserEngineDisposed && Services is not null)
            {
                _browserEngineDisposed = true;
                try { await Services.GetRequiredService<IBrowserEngine>().DisposeAsync(); }
                catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
            }
        };
        window.Activate();
    }
}
