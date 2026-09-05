using Browser.Core.Branding;

namespace Browser.Platform.Windows.Storage;

public sealed class BrowserPaths
{
    public string Root { get; }
    public string DatabasePath => Path.Combine(Root, "browser.db");
    public string WebViewProfilePath => Path.Combine(Root, "WebView2", "Default");
    public string CefProfileRootPath => Path.Combine(Root, "Cef", "Profiles");
    public string CefPrivateRootPath => Path.Combine(Root, "Cef", "Private");
    public string CredentialPath => Path.Combine(Root, "Credentials");
    public string FaviconCachePath => Path.Combine(Root, "Favicons");
    public string FilterListPath => Path.Combine(Root, "Filters", "content-filters.txt");

    public BrowserPaths(string? root = null)
    {
        Root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppBrand.ApplicationId);
        Directory.CreateDirectory(Root);
    }
}
