using System.Text.Json;
using Browser.Core.Navigation;
using Browser.Core.Tabs;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task SendNewTabDashboardAsync(BrowserTab tab, WebView2 web)
    {
        bool IsDashboard() => IsCurrentTabWebView(tab, web) && tab.Url == "browser://newtab" &&
            string.Equals(web.CoreWebView2?.Source, _newTabFileUri, StringComparison.OrdinalIgnoreCase);
        if (!IsDashboard()) return;
        IReadOnlyList<DashboardLink> favorites = [];
        if (!_isPrivate)
        {
            try
            {
                var bookmarks = await _bookmarks.SearchAsync(ct: _windowLifetimeCts.Token, limit: 24);
                favorites = NewTabDashboardPolicy.Select(bookmarks.Select(item => new DashboardLink(item.Title, item.Url)), false, false);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Dashboard bookmarks: {ex.GetType().Name}"); }
        }
        if (!IsDashboard()) return;
        var tabs = NewTabDashboardPolicy.Select(_vm.Tabs.Where(item => item.Id != tab.Id && !item.IsTemporary && !IsNativePageTab(item))
            .OrderByDescending(item => item.LastActivatedAt)
            .Select(item => new DashboardLink(item.Title, item.Url, item.Id, item.IsHibernated)), _isPrivate, true);
        var context = JsonSerializer.Serialize(new
        {
            kind = "sutra-context", theme = _root.ActualTheme == ElementTheme.Light ? "light" : "dark",
            accent = _vm.Settings.AccentColor, profile = _profileName, privateWindow = _isPrivate,
            favorites = favorites.Select(item => new { title = item.Title, url = item.Url }),
            tabs = tabs.Select(item => new { title = item.Title, url = item.Url, tabId = item.TabId, sleeping = item.Sleeping })
        });
        // Check the actual document inside the renderer before delivering local
        // records; a navigation racing this callback must never receive them.
        await web.ExecuteScriptAsync(NewTabDashboardScript
            .Replace("__SUTRA_DASHBOARD_URL__", JsonSerializer.Serialize(_newTabFileUri), StringComparison.Ordinal)
            .Replace("__SUTRA_DASHBOARD_CONTEXT__", context, StringComparison.Ordinal));
    }

    private const string NewTabDashboardScript = """
        (()=>{
          if(window.top!==window||location.href!==__SUTRA_DASHBOARD_URL__)return;
          window.dispatchEvent(new CustomEvent('sutra-dashboard',{detail:__SUTRA_DASHBOARD_CONTEXT__}));
        })()
        """;
}
