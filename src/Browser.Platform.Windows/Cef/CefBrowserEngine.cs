using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Browser.Core.BrowserEngine;

namespace Browser.Platform.Windows.Cef;

/// <summary>
/// Managed owner for the native CEF runtime. This layer deliberately exposes
/// only the engine-neutral contract; UI code must not P/Invoke CEF directly.
/// </summary>
public sealed class CefBrowserEngine : IBrowserEngine
{
    private readonly ConcurrentDictionary<ulong, CefBrowserSurface> _surfaces = new();
    private readonly NativeEventCallback _callback;
    private readonly SynchronizationContext? _callbackContext;
    private CefNativeApi? _native;
    private long _nextSurfaceId;
    private bool _disposed;

    public CefBrowserEngine(CefRuntimeLayout layout) : this(layout, null) { }

    internal CefBrowserEngine(CefRuntimeLayout layout, CefNativeApi? native)
    {
        ArgumentNullException.ThrowIfNull(layout);
        Layout = layout;
        _native = native;
        _callback = OnNativeEvent;
        _callbackContext = SynchronizationContext.Current;
    }

    private CefRuntimeLayout Layout { get; }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        Layout.EnsureRuntimeInstalled();
        _native ??= CefNativeApi.Load(Layout.HostLibraryPath);
        ThrowIfNativeFailed(_native.Initialize(Layout.RuntimePath, Layout.SubprocessPath, Layout.RootCachePath, _callback), "initialize CEF");
        return Task.CompletedTask;
    }

    public async Task<IBrowserSurface> CreateSurfaceAsync(BrowserSurfaceOptions options, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        if (_native is null) throw new InvalidOperationException("Initialize CEF before creating a browser surface.");
        if (options.ParentWindowHandle == nint.Zero) throw new ArgumentException("A browser surface requires a parent HWND.", nameof(options));
        if (string.IsNullOrWhiteSpace(options.Profile.StoragePath)) throw new ArgumentException("A browser surface requires profile storage.", nameof(options));

        var id = checked((ulong)Interlocked.Increment(ref _nextSurfaceId));
        var surface = new CefBrowserSurface(id, _native, RemoveSurface);
        if (!_surfaces.TryAdd(id, surface)) throw new InvalidOperationException("CEF surface identifier collision.");
        try
        {
            var bounds = options.Bounds.Clamp();
            ThrowIfNativeFailed(_native.CreateSurface(id, options.ParentWindowHandle, bounds, options.Profile.StoragePath, options.Profile.Kind == BrowserProfileKind.Private), "create a CEF browser surface");
            await surface.WaitForCreationAsync(cancellationToken);
            return surface;
        }
        catch
        {
            _surfaces.TryRemove(id, out _);
            await surface.DisposeAsync();
            throw;
        }
    }

    private int OnNativeEvent(ulong surfaceId, nint eventJson, nint _)
    {
        var json = Marshal.PtrToStringUni(eventJson);
        if (string.IsNullOrWhiteSpace(json) || !_surfaces.TryGetValue(surfaceId, out var surface)) return 0;

        if (IsDecisionEvent(json))
        {
            var decision = 0;
            if (_callbackContext is null || SynchronizationContext.Current == _callbackContext)
                return surface.HandleNativeEvent(json);
            _callbackContext.Send(_ => decision = surface.HandleNativeEvent(json), null);
            return decision;
        }

        if (_callbackContext is null || SynchronizationContext.Current == _callbackContext)
            surface.HandleNativeEvent(json);
        else
            _callbackContext.Post(_ => surface.HandleNativeEvent(json), null);
        return 0;
    }

    private static bool IsDecisionEvent(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.TryGetProperty("kind", out var kind) &&
                   kind.GetString() is "navigationStarting" or "permission";
        }
        catch (JsonException)
        {
            return json.Contains("navigationStarting", StringComparison.Ordinal);
        }
    }

    private void RemoveSurface(ulong id) => _surfaces.TryRemove(id, out _);

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var surface in _surfaces.Values.ToArray()) await surface.DisposeAsync();
        _surfaces.Clear();
        if (_native is not null)
        {
            ThrowIfNativeFailed(_native.Shutdown(), "shut down CEF");
            _native.Dispose();
        }
    }

    private static void ThrowIfNativeFailed(int result, string operation)
    {
        if (result != 0) throw new InvalidOperationException($"CEF could not {operation} (native error {result}).");
    }
}

internal sealed class CefBrowserSurface : IBrowserSurface
{
    private readonly ulong _id;
    private readonly CefNativeApi _native;
    private readonly Action<ulong> _onDisposed;
    private readonly TaskCompletionSource _created = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly ConcurrentDictionary<int, TaskCompletionSource<string?>> _pendingScripts = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<byte[]?>> _pendingCaptures = new();
    private BrowserSurfaceState _state = new(null, string.Empty, false, false, false);
    private int _nextDevToolsRequestId;
    private bool _canGoBack;
    private bool _canGoForward;
    private bool _disposed;

    public CefBrowserSurface(ulong id, CefNativeApi native, Action<ulong> onDisposed)
    {
        _id = id;
        _native = native;
        _onDisposed = onDisposed;
    }

    public nint NativeHandle => _native.GetWindowHandle(_id);
    public BrowserSurfaceState State => _state;
    public bool CanGoBack => _canGoBack;
    public bool CanGoForward => _canGoForward;

    public event EventHandler<BrowserNavigationStartingEventArgs>? NavigationStarting;
    public event EventHandler<BrowserNavigationCompletedEventArgs>? NavigationCompleted;
    public event EventHandler<BrowserAddressChangedEventArgs>? AddressChanged;
    public event EventHandler<BrowserTitleChangedEventArgs>? TitleChanged;
    public event EventHandler<BrowserHistoryChangedEventArgs>? HistoryChanged;
    public event EventHandler<BrowserStatusChangedEventArgs>? StatusChanged;
    public event EventHandler<BrowserMediaStateChangedEventArgs>? MediaStateChanged;
    public event EventHandler<BrowserPopupRequestedEventArgs>? PopupRequested;
    public event EventHandler<BrowserDownloadRequestedEventArgs>? DownloadRequested;
    public event EventHandler<BrowserPermissionRequestedEventArgs>? PermissionRequested;
    public event EventHandler<BrowserPageMessageEventArgs>? PageMessageReceived;
    public event EventHandler<BrowserProcessFailedEventArgs>? ProcessFailed;
    public event EventHandler<BrowserFullScreenChangedEventArgs>? FullScreenChanged;
    public event EventHandler<BrowserFaviconChangedEventArgs>? FaviconChanged;

    public Task WaitForCreationAsync(CancellationToken cancellationToken) => _created.Task.WaitAsync(cancellationToken);

    public Task NavigateAsync(Uri uri, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(uri);
        cancellationToken.ThrowIfCancellationRequested();
        Invoke(_native.Navigate(_id, uri.AbsoluteUri), "navigate");
        return Task.CompletedTask;
    }

    public Task GoBackAsync(CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.GoBack(_id), "go back"); return Task.CompletedTask; }
    public Task GoForwardAsync(CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.GoForward(_id), "go forward"); return Task.CompletedTask; }
    public Task ReloadAsync(CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.Reload(_id), "reload"); return Task.CompletedTask; }
    public Task StopAsync(CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.Stop(_id), "stop loading"); return Task.CompletedTask; }
    public Task SetMutedAsync(bool muted, CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.SetMuted(_id, muted), "change audio state"); _state = _state with { IsMuted = muted }; return Task.CompletedTask; }
    public Task SetVisibleAsync(bool visible, CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.SetVisible(_id, visible), "change visibility"); _state = _state with { IsVisible = visible }; return Task.CompletedTask; }
    public Task SetBoundsAsync(BrowserBounds bounds, CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.SetBounds(_id, bounds.Clamp()), "resize"); return Task.CompletedTask; }
    public Task FocusAsync(CancellationToken cancellationToken = default) { cancellationToken.ThrowIfCancellationRequested(); Invoke(_native.Focus(_id), "focus"); return Task.CompletedTask; }

    public async Task<string?> ExecuteScriptAsync(string script, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(script);
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();

        var requestId = NextDevToolsRequestId();
        if (requestId <= 0) throw new InvalidOperationException("CEF script request identifiers were exhausted.");
        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pendingScripts.TryAdd(requestId, completion)) throw new InvalidOperationException("CEF script request identifier collision.");

        try
        {
            Invoke(_native.ExecuteScript(_id, requestId, script), "execute script");
        }
        catch
        {
            _pendingScripts.TryRemove(requestId, out _);
            throw;
        }

        using var registration = cancellationToken.Register(() =>
        {
            if (_pendingScripts.TryRemove(requestId, out var pending)) pending.TrySetCanceled(cancellationToken);
        });
        return await completion.Task.ConfigureAwait(false);
    }

    public Task SetZoomAsync(double factor, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Invoke(_native.SetZoom(_id, factor), "change zoom");
        return Task.CompletedTask;
    }

    public async Task<byte[]?> CapturePngAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        var requestId = NextDevToolsRequestId();
        var completion = new TaskCompletionSource<byte[]?>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pendingCaptures.TryAdd(requestId, completion)) throw new InvalidOperationException("CEF capture request identifier collision.");

        try
        {
            Invoke(_native.CapturePng(_id, requestId), "capture a screenshot");
        }
        catch
        {
            _pendingCaptures.TryRemove(requestId, out _);
            throw;
        }

        using var registration = cancellationToken.Register(() =>
        {
            if (_pendingCaptures.TryRemove(requestId, out var pending)) pending.TrySetCanceled(cancellationToken);
        });
        return await completion.Task.ConfigureAwait(false);
    }
    public Task PrintAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Invoke(_native.Print(_id), "print");
        return Task.CompletedTask;
    }

    public Task OpenDevToolsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Invoke(_native.OpenDevTools(_id), "open DevTools");
        return Task.CompletedTask;
    }
    public Task<BrowserRendererInfo?> GetRendererInfoAsync(CancellationToken cancellationToken = default) => Task.FromResult<BrowserRendererInfo?>(null);

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _created.TrySetCanceled();
        foreach (var pending in _pendingScripts.Values) pending.TrySetException(new ObjectDisposedException(nameof(CefBrowserSurface)));
        _pendingScripts.Clear();
        foreach (var pending in _pendingCaptures.Values) pending.TrySetException(new ObjectDisposedException(nameof(CefBrowserSurface)));
        _pendingCaptures.Clear();
        var result = _native.CloseSurface(_id);
        if (result != 0 && result != 2) throw new InvalidOperationException($"CEF could not close the browser surface (native error {result}).");
        if (result == 0) await _closed.Task.WaitAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
        else _closed.TrySetResult();
        _onDisposed(_id);
    }

    internal int HandleNativeEvent(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (!root.TryGetProperty("kind", out var kindProperty)) return 0;
            switch (kindProperty.GetString())
            {
                case "created": _created.TrySetResult(); break;
                case "closed": _closed.TrySetResult(); _onDisposed(_id); break;
                case "navigationStarting":
                    if (!Uri.TryCreate(root.GetProperty("url").GetString(), UriKind.Absolute, out var startingUri)) return 1;
                    var starting = new BrowserNavigationStartingEventArgs(startingUri, root.GetProperty("redirect").GetBoolean());
                    NavigationStarting?.Invoke(this, starting);
                    return starting.Cancel ? 1 : 0;
                case "permission":
                    if (!Uri.TryCreate(root.GetProperty("origin").GetString(), UriKind.Absolute, out var origin) ||
                        !string.Equals(origin.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return 2;
                    var permission = ParsePermission(root.GetProperty("permission").GetString());
                    if (permission == BrowserPermissionKind.Unknown) return 2;
                    var permissionArgs = new BrowserPermissionRequestedEventArgs(
                        origin, permission, root.GetProperty("userGesture").GetBoolean());
                    PermissionRequested?.Invoke(this, permissionArgs);
                    return permissionArgs.Decision switch
                    {
                        BrowserPermissionDecision.Allow => 1,
                        BrowserPermissionDecision.Deny => 2,
                        _ => 0
                    };
                case "loading":
                    var loading = root.GetProperty("isLoading").GetBoolean();
                    _canGoBack = root.GetProperty("canGoBack").GetBoolean();
                    _canGoForward = root.GetProperty("canGoForward").GetBoolean();
                    _state = _state with { IsLoading = loading };
                    HistoryChanged?.Invoke(this, new BrowserHistoryChangedEventArgs(_canGoBack, _canGoForward));
                    if (!loading) NavigationCompleted?.Invoke(this, new BrowserNavigationCompletedEventArgs(_state.Address, true, null));
                    break;
                case "address":
                    if (!Uri.TryCreate(root.GetProperty("url").GetString(), UriKind.Absolute, out var uri)) return 0;
                    _state = _state with { Address = uri };
                    AddressChanged?.Invoke(this, new BrowserAddressChangedEventArgs(uri));
                    break;
                case "title":
                    var title = root.GetProperty("title").GetString() ?? string.Empty;
                    _state = _state with { Title = title };
                    TitleChanged?.Invoke(this, new BrowserTitleChangedEventArgs(title));
                    break;
                case "status": StatusChanged?.Invoke(this, new BrowserStatusChangedEventArgs(root.GetProperty("text").GetString())); break;
                case "fullscreen": FullScreenChanged?.Invoke(this, new BrowserFullScreenChangedEventArgs(root.GetProperty("value").GetBoolean())); break;
                case "loadError": NavigationCompleted?.Invoke(this, new BrowserNavigationCompletedEventArgs(_state.Address, false, root.GetProperty("error").GetString())); break;
                case "scriptResult": CompleteScript(root); break;
                case "popup":
                    if (Uri.TryCreate(root.GetProperty("url").GetString(), UriKind.Absolute, out var popupUri))
                        PopupRequested?.Invoke(this, new BrowserPopupRequestedEventArgs(popupUri, root.GetProperty("userGesture").GetBoolean()));
                    break;
                case "download":
                    if (!Uri.TryCreate(root.GetProperty("url").GetString(), UriKind.Absolute, out var downloadUri)) break;
                    var downloadId = root.GetProperty("downloadId").GetUInt32();
                    var downloadArgs = new BrowserDownloadRequestedEventArgs(
                        downloadUri, root.GetProperty("suggestedName").GetString() ?? "download");
                    DownloadRequested?.Invoke(this, downloadArgs);
                    Invoke(_native.ContinueDownload(_id, downloadId, downloadArgs.DestinationPath, downloadArgs.Cancel), "continue a download");
                    break;
                case "media": MediaStateChanged?.Invoke(this, new BrowserMediaStateChangedEventArgs(root.GetProperty("playing").GetBoolean())); break;
                case "favicon":
                    var bytes = Convert.FromBase64String(root.GetProperty("pngBase64").GetString() ?? string.Empty);
                    if (bytes.Length > 0) FaviconChanged?.Invoke(this, new BrowserFaviconChangedEventArgs(bytes));
                    break;
                case "processFailed":
                    var reason = root.GetProperty("reason").GetString();
                    ProcessFailed?.Invoke(this, new BrowserProcessFailedEventArgs(string.IsNullOrWhiteSpace(reason) ? "CEF renderer process terminated." : reason));
                    break;
                case "audioError": StatusChanged?.Invoke(this, new BrowserStatusChangedEventArgs(root.GetProperty("reason").GetString())); break;
                case "pageMessage":
                    if (!Uri.TryCreate(root.GetProperty("source").GetString(), UriKind.Absolute, out var messageSource)) break;
                    var messageJson = root.GetProperty("message").GetRawText();
                    PageMessageReceived?.Invoke(this, new BrowserPageMessageEventArgs(messageSource, messageJson));
                    break;
            }
        }
        catch (Exception exception) when (exception is JsonException or FormatException or InvalidOperationException)
        {
            ProcessFailed?.Invoke(this, new BrowserProcessFailedEventArgs("CEF emitted malformed event data."));
        }
        return 0;
    }

    private void CompleteScript(JsonElement root)
    {
        if (!root.TryGetProperty("requestId", out var requestProperty) ||
            !requestProperty.TryGetInt32(out var requestId)) return;

        if (_pendingCaptures.TryRemove(requestId, out var capture))
        {
            CompleteCapture(root, capture);
            return;
        }

        if (!_pendingScripts.TryRemove(requestId, out var completion)) return;

        if (!root.TryGetProperty("success", out var successProperty) || !successProperty.GetBoolean())
        {
            var message = root.TryGetProperty("result", out var failure) &&
                          failure.TryGetProperty("message", out var messageProperty)
                ? messageProperty.GetString()
                : null;
            completion.TrySetException(new InvalidOperationException(message ?? "CEF script execution failed."));
            return;
        }

        if (!root.TryGetProperty("result", out var evaluation))
        {
            completion.TrySetResult("null");
            return;
        }

        if (evaluation.TryGetProperty("exceptionDetails", out var exception))
        {
            var message = exception.TryGetProperty("text", out var text) ? text.GetString() : null;
            completion.TrySetException(new InvalidOperationException(message ?? "The page script threw an exception."));
            return;
        }

        if (!evaluation.TryGetProperty("result", out var remoteObject))
        {
            completion.TrySetResult("null");
            return;
        }

        if (remoteObject.TryGetProperty("value", out var value))
        {
            completion.TrySetResult(value.GetRawText());
            return;
        }

        completion.TrySetResult("null");
    }

    private static void CompleteCapture(JsonElement root, TaskCompletionSource<byte[]?> completion)
    {
        if (!root.TryGetProperty("success", out var successProperty) || !successProperty.GetBoolean())
        {
            completion.TrySetException(new InvalidOperationException("CEF screenshot capture failed."));
            return;
        }
        if (!root.TryGetProperty("result", out var result) ||
            !result.TryGetProperty("data", out var dataProperty))
        {
            completion.TrySetResult(null);
            return;
        }
        try
        {
            completion.TrySetResult(Convert.FromBase64String(dataProperty.GetString() ?? string.Empty));
        }
        catch (FormatException exception)
        {
            completion.TrySetException(new InvalidOperationException("CEF returned invalid screenshot data.", exception));
        }
    }

    private int NextDevToolsRequestId()
    {
        var requestId = Interlocked.Increment(ref _nextDevToolsRequestId);
        return requestId > 0 ? requestId : throw new InvalidOperationException("CEF DevTools request identifiers were exhausted.");
    }

    private static BrowserPermissionKind ParsePermission(string? value) => value switch
    {
        "camera" => BrowserPermissionKind.Camera,
        "microphone" => BrowserPermissionKind.Microphone,
        "geolocation" => BrowserPermissionKind.Geolocation,
        "notifications" => BrowserPermissionKind.Notifications,
        "clipboardRead" => BrowserPermissionKind.ClipboardRead,
        "multipleAutomaticDownloads" => BrowserPermissionKind.MultipleAutomaticDownloads,
        _ => BrowserPermissionKind.Unknown
    };

    private static void Invoke(int result, string operation)
    {
        if (result != 0) throw new InvalidOperationException($"CEF could not {operation} (native error {result}).");
    }
}

[UnmanagedFunctionPointer(CallingConvention.StdCall)]
internal delegate int NativeEventCallback(ulong surfaceId, nint eventJson, nint userData);

internal sealed class CefNativeApi : IDisposable
{
    private readonly nint _library;
    private readonly InitializeDelegate _initialize;
    private readonly CreateSurfaceDelegate _createSurface;
    private readonly GetWindowHandleDelegate _getWindowHandle;
    private readonly NavigateDelegate _navigate;
    private readonly SetBoundsDelegate _setBounds;
    private readonly SetVisibleDelegate _setVisible;
    private readonly SurfaceDelegate _focus;
    private readonly SurfaceDelegate _goBack;
    private readonly SurfaceDelegate _goForward;
    private readonly SurfaceDelegate _reload;
    private readonly SurfaceDelegate _stop;
    private readonly SetMutedDelegate _setMuted;
    private readonly ExecuteScriptDelegate _executeScript;
    private readonly CapturePngDelegate _capturePng;
    private readonly ContinueDownloadDelegate _continueDownload;
    private readonly SetZoomDelegate _setZoom;
    private readonly SurfaceDelegate _print;
    private readonly SurfaceDelegate _openDevTools;
    private readonly SurfaceDelegate _closeSurface;
    private readonly ShutdownDelegate _shutdown;

    private CefNativeApi(nint library)
    {
        _library = library;
        _initialize = Bind<InitializeDelegate>("SutraCefInitialize");
        _createSurface = Bind<CreateSurfaceDelegate>("SutraCefCreateSurface");
        _getWindowHandle = Bind<GetWindowHandleDelegate>("SutraCefGetWindowHandle");
        _navigate = Bind<NavigateDelegate>("SutraCefNavigate");
        _setBounds = Bind<SetBoundsDelegate>("SutraCefSetBounds");
        _setVisible = Bind<SetVisibleDelegate>("SutraCefSetVisible");
        _focus = Bind<SurfaceDelegate>("SutraCefFocus");
        _goBack = Bind<SurfaceDelegate>("SutraCefGoBack");
        _goForward = Bind<SurfaceDelegate>("SutraCefGoForward");
        _reload = Bind<SurfaceDelegate>("SutraCefReload");
        _stop = Bind<SurfaceDelegate>("SutraCefStop");
        _setMuted = Bind<SetMutedDelegate>("SutraCefSetMuted");
        _executeScript = Bind<ExecuteScriptDelegate>("SutraCefExecuteScript");
        _capturePng = Bind<CapturePngDelegate>("SutraCefCapturePng");
        _continueDownload = Bind<ContinueDownloadDelegate>("SutraCefContinueDownload");
        _setZoom = Bind<SetZoomDelegate>("SutraCefSetZoom");
        _print = Bind<SurfaceDelegate>("SutraCefPrint");
        _openDevTools = Bind<SurfaceDelegate>("SutraCefOpenDevTools");
        _closeSurface = Bind<SurfaceDelegate>("SutraCefCloseSurface");
        _shutdown = Bind<ShutdownDelegate>("SutraCefShutdown");
    }

    public static CefNativeApi Load(string path)
    {
        const uint loadLibrarySearchDllLoadDir = 0x00000100;
        const uint loadLibrarySearchDefaultDirs = 0x00001000;
        var library = LoadLibraryEx(path, nint.Zero, loadLibrarySearchDllLoadDir | loadLibrarySearchDefaultDirs);
        if (library == nint.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), $"Unable to load the bundled CEF host from '{path}'.");
        return new CefNativeApi(library);
    }
    public int Initialize(string runtimePath, string subprocessPath, string rootCachePath, NativeEventCallback callback) => _initialize(runtimePath, subprocessPath, rootCachePath, callback, nint.Zero);
    public int CreateSurface(ulong id, nint parent, BrowserBounds bounds, string cachePath, bool isPrivate) => _createSurface(id, parent, bounds.X, bounds.Y, bounds.Width, bounds.Height, cachePath, isPrivate ? 1 : 0);
    public nint GetWindowHandle(ulong id) => _getWindowHandle(id);
    public int Navigate(ulong id, string uri) => _navigate(id, uri);
    public int SetBounds(ulong id, BrowserBounds bounds) => _setBounds(id, bounds.X, bounds.Y, bounds.Width, bounds.Height);
    public int SetVisible(ulong id, bool visible) => _setVisible(id, visible ? 1 : 0);
    public int Focus(ulong id) => _focus(id);
    public int GoBack(ulong id) => _goBack(id);
    public int GoForward(ulong id) => _goForward(id);
    public int Reload(ulong id) => _reload(id);
    public int Stop(ulong id) => _stop(id);
    public int SetMuted(ulong id, bool muted) => _setMuted(id, muted ? 1 : 0);
    public int ExecuteScript(ulong id, int requestId, string script) => _executeScript(id, requestId, script);
    public int CapturePng(ulong id, int requestId) => _capturePng(id, requestId);
    public int ContinueDownload(ulong id, uint downloadId, string? destinationPath, bool cancel) =>
        _continueDownload(id, downloadId, destinationPath ?? string.Empty, cancel ? 1 : 0);
    public int SetZoom(ulong id, double factor) => _setZoom(id, factor);
    public int Print(ulong id) => _print(id);
    public int OpenDevTools(ulong id) => _openDevTools(id);
    public int CloseSurface(ulong id) => _closeSurface(id);
    public int Shutdown() => _shutdown();
    public void Dispose() => NativeLibrary.Free(_library);

    private T Bind<T>(string name) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(_library, name));

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)] private delegate int InitializeDelegate(string runtimePath, string subprocessPath, string rootCachePath, NativeEventCallback callback, nint userData);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)] private delegate int CreateSurfaceDelegate(ulong id, nint parent, int x, int y, int width, int height, string cachePath, int privateMode);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate nint GetWindowHandleDelegate(ulong id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)] private delegate int NavigateDelegate(ulong id, string uri);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetBoundsDelegate(ulong id, int x, int y, int width, int height);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetVisibleDelegate(ulong id, int visible);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetMutedDelegate(ulong id, int muted);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)] private delegate int ExecuteScriptDelegate(ulong id, int requestId, string script);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int CapturePngDelegate(ulong id, int requestId);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)] private delegate int ContinueDownloadDelegate(ulong id, uint downloadId, string destinationPath, int cancel);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetZoomDelegate(ulong id, double factor);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SurfaceDelegate(ulong id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ShutdownDelegate();

    [DllImport("kernel32", EntryPoint = "LoadLibraryExW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint LoadLibraryEx(string fileName, nint file, uint flags);
}
