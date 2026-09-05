using System.Runtime.InteropServices;
using Browser.Core.BrowserEngine;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace Browser.App;

/// <summary>
/// Keeps a windowed CEF child HWND aligned with a XAML placeholder. Native
/// browser windows use physical client pixels while WinUI layout uses DIPs.
/// </summary>
internal sealed class NativeBrowserPresenter : IAsyncDisposable
{
    private readonly FrameworkElement _coordinateRoot;
    private readonly nint _parentWindow;
    private readonly IBrowserSurface _surface;
    private readonly Action<Exception>? _onError;
    private long _visibilityToken;
    private bool _disposed;
    private bool _updateQueued;

    public NativeBrowserPresenter(
        FrameworkElement coordinateRoot,
        nint parentWindow,
        IBrowserSurface surface,
        Action<Exception>? onError = null)
    {
        ArgumentNullException.ThrowIfNull(coordinateRoot);
        ArgumentNullException.ThrowIfNull(surface);
        if (parentWindow == nint.Zero) throw new ArgumentException("A native presenter requires a parent HWND.", nameof(parentWindow));

        _coordinateRoot = coordinateRoot;
        _parentWindow = parentWindow;
        _surface = surface;
        _onError = onError;
        Placeholder = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent)
        };

        Placeholder.Loaded += OnLayoutChanged;
        Placeholder.Unloaded += OnLayoutChanged;
        Placeholder.SizeChanged += OnSizeChanged;
        Placeholder.LayoutUpdated += OnLayoutUpdated;
        Placeholder.PointerPressed += OnPointerPressed;
        _visibilityToken = Placeholder.RegisterPropertyChangedCallback(UIElement.VisibilityProperty, OnVisibilityChanged);
    }

    public Border Placeholder { get; }
    public IBrowserSurface Surface => _surface;

    public Task ShowAsync(CancellationToken cancellationToken = default)
    {
        Placeholder.Visibility = Visibility.Visible;
        QueueBoundsUpdate();
        return _surface.SetVisibleAsync(true, cancellationToken);
    }

    public Task HideAsync(CancellationToken cancellationToken = default)
    {
        Placeholder.Visibility = Visibility.Collapsed;
        return _surface.SetVisibleAsync(false, cancellationToken);
    }

    private void OnLayoutChanged(object sender, RoutedEventArgs args) => QueueBoundsUpdate();
    private void OnSizeChanged(object sender, SizeChangedEventArgs args) => QueueBoundsUpdate();
    private void OnLayoutUpdated(object? sender, object args) => QueueBoundsUpdate();
    private void OnVisibilityChanged(DependencyObject sender, DependencyProperty property) => QueueBoundsUpdate();

    private void OnPointerPressed(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs args)
    {
        Run(_surface.FocusAsync());
    }

    private void QueueBoundsUpdate()
    {
        if (_disposed || _updateQueued) return;
        _updateQueued = true;
        Placeholder.DispatcherQueue.TryEnqueue(() =>
        {
            _updateQueued = false;
            UpdateBounds();
        });
    }

    private void UpdateBounds()
    {
        if (_disposed) return;
        var visible = Placeholder.IsLoaded && Placeholder.Visibility == Visibility.Visible &&
                      Placeholder.ActualWidth > 0 && Placeholder.ActualHeight > 0;
        if (!visible)
        {
            Run(_surface.SetVisibleAsync(false));
            return;
        }

        try
        {
            var origin = Placeholder.TransformToVisual(_coordinateRoot).TransformPoint(new Point());
            var scale = GetDpiForWindow(_parentWindow) / 96d;
            var bounds = new BrowserBounds(
                (int)Math.Round(origin.X * scale),
                (int)Math.Round(origin.Y * scale),
                Math.Max(1, (int)Math.Round(Placeholder.ActualWidth * scale)),
                Math.Max(1, (int)Math.Round(Placeholder.ActualHeight * scale)));
            Run(UpdateSurfaceAsync(bounds));
        }
        catch (Exception exception)
        {
            _onError?.Invoke(exception);
        }
    }

    private async Task UpdateSurfaceAsync(BrowserBounds bounds)
    {
        await _surface.SetBoundsAsync(bounds).ConfigureAwait(false);
        await _surface.SetVisibleAsync(true).ConfigureAwait(false);
    }

    private async void Run(Task operation)
    {
        try { await operation; }
        catch (Exception exception) when (!_disposed) { _onError?.Invoke(exception); }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Placeholder.Loaded -= OnLayoutChanged;
        Placeholder.Unloaded -= OnLayoutChanged;
        Placeholder.SizeChanged -= OnSizeChanged;
        Placeholder.LayoutUpdated -= OnLayoutUpdated;
        Placeholder.PointerPressed -= OnPointerPressed;
        if (_visibilityToken != 0)
        {
            Placeholder.UnregisterPropertyChangedCallback(UIElement.VisibilityProperty, _visibilityToken);
            _visibilityToken = 0;
        }
        await _surface.DisposeAsync();
    }

    [DllImport("user32")]
    private static extern uint GetDpiForWindow(nint window);
}
