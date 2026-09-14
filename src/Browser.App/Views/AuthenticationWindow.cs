using Browser.Core.Branding;
using Browser.Platform.Windows.WebView;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Graphics;

namespace Browser.App;

/// <summary>
/// A deliberately small, browser-owned window for trusted OAuth/identity flows.
/// It uses the requesting browser profile so the identity provider can complete
/// its normal cookie-based handoff, without turning the flow into a regular tab.
/// </summary>
public sealed class AuthenticationWindow : Window
{
    private readonly bool _isPrivate;
    private readonly string _initialUrl;
    private readonly string _profileName;
    private readonly bool _isPopup;
    private readonly WebView2 _webView = new();
    private readonly WebViewEnvironmentManager _environment = App.Services.GetRequiredService<WebViewEnvironmentManager>();
    private bool _initialized;
    private bool _closed;

    internal void PreparePrivacyShutdown()
    {
        _closed = true;
        try { _webView.Close(); } catch { }
    }

    public AuthenticationWindow(bool isPrivate, string initialUrl, string profileName, bool isPopup = false)
    {
        _isPrivate = isPrivate;
        _initialUrl = initialUrl;
        _profileName = profileName;
        _isPopup = isPopup;
        Title = $"Sign in — {AppBrand.Name}";
        AppWindow.Resize(new SizeInt32(520, 720));

        var close = new Button { Content = "Close", Margin = new Thickness(8, 6, 10, 6) };
        close.Click += (_, _) => Close();
        var header = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 32, 32, 32)) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new TextBlock
        {
            Text = "Secure sign-in window",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(14, 0, 0, 0),
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 255, 255, 255))
        };
        Grid.SetColumn(close, 1);
        header.Children.Add(label);
        header.Children.Add(close);

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_webView, 1);
        root.Children.Add(header);
        root.Children.Add(_webView);
        Content = root;
        Closed += (_, _) => PreparePrivacyShutdown();
        Activated += async (_, _) =>
        {
            if (_initialized || _isPopup || _closed) return;
            _initialized = true;
            await InitializeAsync();
        };
    }

    internal async Task AttachPopupAsync(CoreWebView2NewWindowRequestedEventArgs request)
    {
        if (_initialized) return;
        _initialized = true;
        try
        {
            await InitializeCoreAsync();
            if (_closed) { request.Handled = true; return; }
            request.NewWindow = _webView.CoreWebView2;
        }
        catch
        {
            request.Handled = true;
            Close();
        }
    }

    private async Task InitializeAsync()
    {
        try
        {
            await InitializeCoreAsync();
            if (_closed) return;
            _webView.CoreWebView2.Navigate(_initialUrl);
        }
        catch
        {
            if (_closed) return;
            Content = new TextBlock
            {
                Text = "Sutra could not open this sign-in window. Close it and try again.",
                Margin = new Thickness(24),
                TextWrapping = TextWrapping.Wrap
            };
        }
    }

    private async Task InitializeCoreAsync()
    {
            var environment = await _environment.GetAsync();
            if (_closed) throw new OperationCanceledException();
            if (_isPrivate)
            {
                var options = environment.CreateCoreWebView2ControllerOptions();
                options.ProfileName = AppBrand.PrivateProfileName;
                options.IsInPrivateModeEnabled = true;
                await _webView.EnsureCoreWebView2Async(environment, options);
            }
            else if (!_profileName.Equals("Default", StringComparison.OrdinalIgnoreCase))
            {
                var options = environment.CreateCoreWebView2ControllerOptions();
                options.ProfileName = Browser.Core.Profiles.ProfileIdentity.WebViewName(_profileName);
                await _webView.EnsureCoreWebView2Async(environment, options);
            }
            else await _webView.EnsureCoreWebView2Async(environment);

            if (_closed) { try { _webView.Close(); } catch { } throw new OperationCanceledException(); }

            var core = _webView.CoreWebView2;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.WindowCloseRequested += (_, _) => DispatcherQueue.TryEnqueue(Close);
            core.NewWindowRequested += (_, e) =>
            {
                // Identity providers sometimes chain a second popup. Keep it inside
                // this constrained sign-in window rather than spawning an app tab.
                e.Handled = true;
                if (!string.IsNullOrWhiteSpace(e.Uri)) core.Navigate(e.Uri);
            };
    }
}
