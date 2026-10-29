using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class MainWindow
{
    // WinUI needs a loaded XamlRoot before controller creation can finish. Keep
    // initialization on this window's UI thread, using the shared environment.
    private readonly Grid _webViewInitializationHost = new()
    {
        Width = 1, Height = 1, Opacity = 0, IsHitTestVisible = false,
        HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top
    };

    private async Task InitializeAttachedWebViewAsync(WebView2 view, CoreWebView2Environment environment, CoreWebView2ControllerOptions? options = null, CancellationToken cancellationToken = default)
    {
        var loaded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var linkedLifetime = CancellationTokenSource.CreateLinkedTokenSource(_windowLifetimeCts.Token, cancellationToken);
        var lifetimeToken = linkedLifetime.Token;
        void OnLoaded(object sender, RoutedEventArgs args) => loaded.TrySetResult(true);
        view.Loaded += OnLoaded;
        try
        {
            if (view.Parent is null) _webViewInitializationHost.Children.Add(view);
            if (view.IsLoaded) loaded.TrySetResult(true);
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20), lifetimeToken);
            var initialization = options is null ? view.EnsureCoreWebView2Async(environment) : view.EnsureCoreWebView2Async(environment, options);
            await initialization.AsTask().WaitAsync(TimeSpan.FromSeconds(30), lifetimeToken);
            if (_isWindowClosed) throw new OperationCanceledException();
            lifetimeToken.ThrowIfCancellationRequested();
        }
        catch
        {
            DetachWebView(view);
            try { view.Close(); } catch { }
            throw;
        }
        finally { view.Loaded -= OnLoaded; }
    }
}
