namespace Browser.Core.BrowserEngine;

/// <summary>
/// Browser-engine-neutral lifecycle contract. Engine implementations must keep
/// page content untrusted and must not expose credentials through events or
/// script results.
/// </summary>
public interface IBrowserEngine : IAsyncDisposable
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task<IBrowserSurface> CreateSurfaceAsync(BrowserSurfaceOptions options, CancellationToken cancellationToken = default);
}

public interface IBrowserSurface : IAsyncDisposable
{
    nint NativeHandle { get; }
    BrowserSurfaceState State { get; }
    bool CanGoBack { get; }
    bool CanGoForward { get; }

    event EventHandler<BrowserNavigationStartingEventArgs>? NavigationStarting;
    event EventHandler<BrowserNavigationCompletedEventArgs>? NavigationCompleted;
    event EventHandler<BrowserAddressChangedEventArgs>? AddressChanged;
    event EventHandler<BrowserTitleChangedEventArgs>? TitleChanged;
    event EventHandler<BrowserHistoryChangedEventArgs>? HistoryChanged;
    event EventHandler<BrowserStatusChangedEventArgs>? StatusChanged;
    event EventHandler<BrowserMediaStateChangedEventArgs>? MediaStateChanged;
    event EventHandler<BrowserPopupRequestedEventArgs>? PopupRequested;
    event EventHandler<BrowserDownloadRequestedEventArgs>? DownloadRequested;
    event EventHandler<BrowserPermissionRequestedEventArgs>? PermissionRequested;
    event EventHandler<BrowserPageMessageEventArgs>? PageMessageReceived;
    event EventHandler<BrowserProcessFailedEventArgs>? ProcessFailed;
    event EventHandler<BrowserFullScreenChangedEventArgs>? FullScreenChanged;
    event EventHandler<BrowserFaviconChangedEventArgs>? FaviconChanged;

    Task NavigateAsync(Uri uri, CancellationToken cancellationToken = default);
    Task GoBackAsync(CancellationToken cancellationToken = default);
    Task GoForwardAsync(CancellationToken cancellationToken = default);
    Task ReloadAsync(CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
    Task<string?> ExecuteScriptAsync(string script, CancellationToken cancellationToken = default);
    Task SetZoomAsync(double factor, CancellationToken cancellationToken = default);
    Task SetMutedAsync(bool muted, CancellationToken cancellationToken = default);
    Task SetVisibleAsync(bool visible, CancellationToken cancellationToken = default);
    Task SetBoundsAsync(BrowserBounds bounds, CancellationToken cancellationToken = default);
    Task FocusAsync(CancellationToken cancellationToken = default);
    Task<byte[]?> CapturePngAsync(CancellationToken cancellationToken = default);
    Task PrintAsync(CancellationToken cancellationToken = default);
    Task OpenDevToolsAsync(CancellationToken cancellationToken = default);
    Task<BrowserRendererInfo?> GetRendererInfoAsync(CancellationToken cancellationToken = default);
}

public sealed record BrowserSurfaceOptions(
    nint ParentWindowHandle,
    BrowserBounds Bounds,
    BrowserProfile Profile,
    bool EnableDevTools = true,
    bool EnableContextMenus = true);

public sealed record BrowserProfile(string Name, BrowserProfileKind Kind, string? StoragePath)
{
    public static BrowserProfile Persistent(string name, string storagePath) =>
        new(NormalizeName(name), BrowserProfileKind.Persistent, RequireStoragePath(storagePath));

    public static BrowserProfile Private(string name, string temporaryStoragePath) =>
        new(NormalizeName(name), BrowserProfileKind.Private, RequireStoragePath(temporaryStoragePath));

    private static string NormalizeName(string value)
    {
        var normalized = new string((value ?? string.Empty).Where(char.IsLetterOrDigit).Take(50).ToArray());
        return string.IsNullOrWhiteSpace(normalized) ? "Default" : normalized;
    }

    private static string RequireStoragePath(string value) =>
        string.IsNullOrWhiteSpace(value) ? throw new ArgumentException("A browser profile requires a storage path.", nameof(value)) : value;
}

public enum BrowserProfileKind { Persistent, Private }

public readonly record struct BrowserBounds(int X, int Y, int Width, int Height)
{
    public BrowserBounds Clamp() => new(Math.Max(0, X), Math.Max(0, Y), Math.Max(0, Width), Math.Max(0, Height));
}

public sealed record BrowserSurfaceState(Uri? Address, string Title, bool IsLoading, bool IsMuted, bool IsVisible);
public sealed record BrowserRendererInfo(int ProcessId, long? WorkingSetBytes, bool IsShared, int SharingTabCount);

public sealed class BrowserNavigationStartingEventArgs(Uri uri, bool isRedirect) : EventArgs
{
    public Uri Uri { get; } = uri;
    public bool IsRedirect { get; } = isRedirect;
    public bool Cancel { get; set; }
}

public sealed class BrowserNavigationCompletedEventArgs(Uri? uri, bool isSuccess, string? error) : EventArgs
{ public Uri? Uri { get; } = uri; public bool IsSuccess { get; } = isSuccess; public string? Error { get; } = error; }
public sealed class BrowserAddressChangedEventArgs(Uri uri) : EventArgs
{ public Uri Uri { get; } = uri; }
public sealed class BrowserTitleChangedEventArgs(string title) : EventArgs
{ public string Title { get; } = title; }
public sealed class BrowserHistoryChangedEventArgs(bool canGoBack, bool canGoForward) : EventArgs
{ public bool CanGoBack { get; } = canGoBack; public bool CanGoForward { get; } = canGoForward; }
public sealed class BrowserStatusChangedEventArgs(string? text) : EventArgs
{ public string? Text { get; } = text; }
public sealed class BrowserMediaStateChangedEventArgs(bool isPlaying) : EventArgs
{ public bool IsPlaying { get; } = isPlaying; }
public sealed class BrowserFullScreenChangedEventArgs(bool isFullScreen) : EventArgs
{ public bool IsFullScreen { get; } = isFullScreen; }
public sealed class BrowserFaviconChangedEventArgs(byte[] pngBytes) : EventArgs
{ public byte[] PngBytes { get; } = pngBytes; }
public sealed class BrowserProcessFailedEventArgs(string reason) : EventArgs
{ public string Reason { get; } = reason; }

public sealed class BrowserPopupRequestedEventArgs(Uri uri, bool isUserInitiated) : EventArgs
{
    public Uri Uri { get; } = uri;
    public bool IsUserInitiated { get; } = isUserInitiated;
    public bool Handled { get; set; }
}

public sealed class BrowserDownloadRequestedEventArgs(Uri source, string suggestedFileName) : EventArgs
{
    public Uri Source { get; } = source;
    public string SuggestedFileName { get; } = suggestedFileName;
    public string? DestinationPath { get; set; }
    public bool Cancel { get; set; }
}

public enum BrowserPermissionKind { Unknown, Camera, Microphone, Geolocation, Notifications, ClipboardRead, MultipleAutomaticDownloads }
public enum BrowserPermissionDecision { Default, Allow, Deny }

public sealed class BrowserPermissionRequestedEventArgs(Uri origin, BrowserPermissionKind kind, bool isUserInitiated) : EventArgs
{
    public Uri Origin { get; } = origin;
    public BrowserPermissionKind Kind { get; } = kind;
    public bool IsUserInitiated { get; } = isUserInitiated;
    public BrowserPermissionDecision Decision { get; set; } = BrowserPermissionDecision.Default;
}

/// <summary>Messages are accepted only after the app validates both the source origin and JSON payload.</summary>
public sealed class BrowserPageMessageEventArgs(Uri source, string json) : EventArgs
{ public Uri Source { get; } = source; public string Json { get; } = json; }
