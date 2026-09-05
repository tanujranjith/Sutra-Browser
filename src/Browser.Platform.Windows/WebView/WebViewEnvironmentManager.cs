using Browser.Platform.Windows.Storage;
using Microsoft.Web.WebView2.Core;

namespace Browser.Platform.Windows.WebView;

public sealed class WebViewEnvironmentManager(BrowserPaths paths)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CoreWebView2Environment? _environment;

    public async Task<CoreWebView2Environment> GetAsync()
    {
        if (_environment is not null) return _environment;
        await _gate.WaitAsync();
        try
        {
            return _environment ??= await CoreWebView2Environment.CreateWithOptionsAsync(string.Empty, paths.WebViewProfilePath,
                new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = "--disable-features=msEdgeSidebarV2" });
        }
        finally { _gate.Release(); }
    }
}
