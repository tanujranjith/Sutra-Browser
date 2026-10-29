using System.Security.Cryptography;
using System.Text;
using Browser.Core.Diagnostics;
using Browser.Core.Runtime;
using Browser.Core.Tabs;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Streams;

namespace Browser.App;

public sealed partial class MainWindow
{
    private readonly BackgroundWorkSet _assetWrites = new();

    private Task WriteAssetAsync(string path, byte[] bytes, CancellationToken cancellationToken) => _assetWrites.RunAsync(async () =>
    {
        var temporary = Path.Combine(_faviconDirectory, $"asset-{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllBytesAsync(temporary, bytes, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary, path, overwrite: true);
        }
        finally { try { File.Delete(temporary); } catch { } }
    });

    private void RemoveTabThumbnail(BrowserTab tab, string? path = null)
    {
        path ??= tab.ThumbnailPath;
        if (!GeneratedThumbnailPolicy.IsOwnedPath(_faviconDirectory, tab.Id, path)) return;
        try { File.Delete(path!); } catch { /* The bounded cache purge can retry a locked image later. */ }
        if (path == tab.ThumbnailPath) tab.ThumbnailPath = null;
    }

    private async Task UpdateFaviconAsync(BrowserTab tab, CoreWebView2 core)
    {
        if (_isWindowClosed || !_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 != core || !IsCurrentTabWebView(tab, web)) return;
        var state = NavigationState(web);
        if (state.FaviconInFlight) return;
        state.FaviconInFlight = true;
        var generation = state.AssetGeneration;
        var favicon = core.FaviconUri;
        var lifetime = _windowLifetimeCts.Token;
        try
        {
            using var randomAccess = await core.GetFaviconAsync(CoreWebView2FaviconImageFormat.Png);
            if (!IsCurrentTabWebView(tab, web) || state.AssetGeneration != generation || core.FaviconUri != favicon) return;
            using var source = randomAccess.AsStreamForRead();
            if (source.Length is <= 0 or > 1024 * 1024) return;
            var bytes = new byte[(int)source.Length];
            await source.ReadExactlyAsync(bytes, lifetime);
            if (!IsCurrentTabWebView(tab, web) || state.AssetGeneration != generation || core.FaviconUri != favicon) return;
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(favicon ?? tab.Url))).ToLowerInvariant();
            var path = Path.Combine(_faviconDirectory, $"{key}.png");
            // Reuse the existing image instead of rewriting it on every page load.
            if (!File.Exists(path) || File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddDays(-1))
                await WriteAssetAsync(path, bytes, lifetime);
            if (!IsCurrentTabWebView(tab, web) || state.AssetGeneration != generation || core.FaviconUri != favicon) return;
            tab.FaviconPath = path;
            QueueTabListRefresh();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Favicon update: {ex.GetType().Name}"); }
        finally
        {
            state.FaviconInFlight = false;
            try
            {
                if (IsCurrentTabWebView(tab, web) && (state.AssetGeneration != generation || core.FaviconUri != favicon))
                    ObserveUiCallback("Latest favicon", () => UpdateFaviconAsync(tab, core));
            }
            catch { /* A failed or closed controller cannot provide a new favicon. */ }
        }
    }

    private async Task UpdateTabThumbnailAsync(BrowserTab tab, WebView2 web)
    {
        if (!IsCurrentTabWebView(tab, web)) return;
        var state = NavigationState(web);
        if (state.ThumbnailInFlight) return;
        state.ThumbnailInFlight = true;
        var generation = state.AssetGeneration;
        var lifetime = _windowLifetimeCts.Token;
        string? writtenPath = null;
        bool Current() => IsCurrentTabWebView(tab, web) && state.AssetGeneration == generation && !tab.IsLoading;
        try
        {
            await Task.Delay(350, lifetime);
            if (!Current() || web.CoreWebView2 is not { } core) return;
            using var randomAccess = new InMemoryRandomAccessStream();
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, randomAccess);
            if (!Current() || randomAccess.Size is 0 or > 4 * 1024 * 1024) return;
            randomAccess.Seek(0);
            using var source = randomAccess.AsStreamForRead();
            var bytes = new byte[(int)source.Length];
            await source.ReadExactlyAsync(bytes, lifetime);
            if (!Current()) return;
            writtenPath = Path.Combine(_faviconDirectory, $"thumb-{tab.Id:N}-{Guid.NewGuid():N}.jpg");
            await WriteAssetAsync(writtenPath, bytes, lifetime);
            if (!Current()) return;
            var previous = tab.ThumbnailPath;
            tab.ThumbnailPath = writtenPath;
            writtenPath = null;
            if (previous is not null) RemoveTabThumbnail(tab, previous);
            QueueTabListRefresh();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Thumbnail update: {ex.GetType().Name}"); }
        finally
        {
            if (writtenPath is not null) RemoveTabThumbnail(tab, writtenPath);
            state.ThumbnailInFlight = false;
            if (IsCurrentTabWebView(tab, web) && state.AssetGeneration != generation && !tab.IsLoading)
                ObserveUiCallback("Latest thumbnail", () => UpdateTabThumbnailAsync(tab, web));
        }
    }
}
