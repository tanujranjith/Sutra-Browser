using Microsoft.Web.WebView2.Core;

namespace Browser.Platform.Windows.WebView;

/// <summary>Configures the local desktop workspace without deleting its durable data.</summary>
public static class SutraWorkspaceWebViewPolicy
{
    public static async Task ConfigureAsync(CoreWebView2 core)
    {
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        // The desktop bundle is already available offline. Always read the installed
        // files so upstream fixes take effect after an app update even if a hosted
        // Sutra service worker would otherwise retain a versioned asset URL.
        // Cookies, IndexedDB, attachments, and workspace settings remain intact.
        await core.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
        await core.CallDevToolsProtocolMethodAsync("Network.setBypassServiceWorker", "{\"bypass\":true}");
        await core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":true}");
    }
}
