using System.Text.Json;
using Browser.Core.Privacy;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Streams;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task LoadContentBlockRulesAsync()
    {
        _contentBlockRules = await Task.Run(() =>
        {
            IEnumerable<string> rules = BuiltInContentFilters.Rules;
            if (File.Exists(_paths.FilterListPath)) rules = rules.Concat(File.ReadLines(_paths.FilterListPath));
            return ContentBlockRuleSet.Parse(rules);
        });
    }

    private async Task EnsureContentFiltersAvailableAsync()
    {
        // On first run there is no downloaded list, which made the old tiny fallback
        // look like ad blocking was broken. These are public static filter lists;
        // no page URL, cookie, history, or account information is sent.
        if (!_vm.Settings.AdBlockingEnabled || File.Exists(_paths.FilterListPath) || _vm.Settings.FilterListUrls.Length == 0) return;
        await UpdateContentFiltersAsync();
    }

    private void OnWebResourceRequested(BrowserTab tab, CoreWebView2 core, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!_vm.Settings.AdBlockingEnabled || e.ResourceContext == CoreWebView2WebResourceContext.Document) return;
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var resource) || IsContentBlockingAllowedForSite(tab.Url)) return;
        if (!_contentBlockRules.ShouldBlock(resource)) return;
        e.Response = core.Environment.CreateWebResourceResponse(new InMemoryRandomAccessStream(), 403, "Blocked by Sutra", "Content-Type: text/plain\r\nCache-Control: no-store");
        _blockedRequestCounts[tab.Id] = _blockedRequestCounts.GetValueOrDefault(tab.Id) + 1;
        if (tab.Id == _vm.SelectedTab?.Id) DispatcherQueue.TryEnqueue(() => UpdateShieldState(tab));
    }

    private async Task ApplyCosmeticFiltersAsync(BrowserTab tab, WebView2 web)
    {
        if (!_vm.Settings.AdBlockingEnabled || !_vm.Settings.CosmeticFilteringEnabled || IsContentBlockingAllowedForSite(tab.Url)) return;
        if (!Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        var selectors = _contentBlockRules.CosmeticSelectorsFor(uri.Host);
        if (selectors.Count == 0) return;
        var css = string.Join(',', selectors) + "{display:none!important}";
        var cssJson = JsonSerializer.Serialize(css);
        try
        {
            await web.ExecuteScriptAsync($"(()=>{{let s=document.getElementById('__sutra_content_filters');if(!s){{s=document.createElement('style');s.id='__sutra_content_filters';(document.head||document.documentElement).appendChild(s);}}s.textContent={cssJson};}})()");
        }
        catch { }
    }

    private bool IsContentBlockingAllowedForSite(string pageUrl)
    {
        if (!Uri.TryCreate(pageUrl, UriKind.Absolute, out var uri)) return true;
        return _vm.Settings.AdBlockAllowlist.Any(domain => ContentBlockRuleSet.DomainMatches(uri.Host, domain));
    }

    private void UpdateShieldState(BrowserTab tab)
    {
        var allowed = IsContentBlockingAllowedForSite(tab.Url);
        var count = _blockedRequestCounts.GetValueOrDefault(tab.Id);
        _shield.Opacity = !_vm.Settings.AdBlockingEnabled || allowed ? .55 : count > 0 ? 1 : .78;
        ToolTipService.SetToolTip(_shield, !_vm.Settings.AdBlockingEnabled ? "Content blocking is off" : allowed ? "Content blocking is off for this site" : $"Privacy protection · {count} blocked");
    }

    private async Task ShowSiteInformationAsync()
    {
        var tab = _vm.SelectedTab;
        if (tab is null) return;
        var hasOrigin = Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";
        var host = hasOrigin ? uri!.Host : "Local page";
        var allowed = IsContentBlockingAllowedForSite(tab.Url);
        var count = _blockedRequestCounts.GetValueOrDefault(tab.Id);
        var panel = new StackPanel { Width = 370, Spacing = 13, Padding = new(4) };
        panel.Children.Add(new TextBlock { Text = host, FontSize = 18, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
        panel.Children.Add(new TextBlock { Text = hasOrigin ? (uri!.Scheme == "https" ? "Secure HTTPS connection" : "Unencrypted HTTP connection") : "Browser-owned local page", Opacity = .65 });
        panel.Children.Add(new TextBlock { Text = $"{count} network request{(count == 1 ? "" : "s")} blocked in this tab\n{_contentBlockRules.NetworkRuleCount:N0} network and {_contentBlockRules.CosmeticRuleCount:N0} cosmetic rules loaded", TextWrapping = TextWrapping.Wrap });
        if (hasOrigin && !_isPrivate)
        {
            var decisions = await _permissions.ListForOriginAsync(uri!.GetLeftPart(UriPartial.Authority));
            panel.Children.Add(new TextBlock { Text = decisions.Count == 0 ? "No saved permission decisions" : "Saved permissions: " + string.Join(", ", decisions.Select(x => $"{x.Kind} {x.Decision.ToLowerInvariant()}")), TextWrapping = TextWrapping.Wrap, Opacity = .72 });
        }

        var global = new ToggleSwitch { Header = "Block ads and trackers", IsOn = _vm.Settings.AdBlockingEnabled };
        var site = new ToggleSwitch { Header = "Protection for this site", IsOn = !allowed, IsEnabled = hasOrigin && _vm.Settings.AdBlockingEnabled };
        global.Toggled += async (_, _) =>
        {
            _vm.Settings = _vm.Settings with { AdBlockingEnabled = global.IsOn };
            await SaveSettingsSafeAsync();
            site.IsEnabled = hasOrigin && global.IsOn;
            CurrentWebView()?.Reload();
        };
        site.Toggled += async (_, _) =>
        {
            if (!hasOrigin) return;
            var list = _vm.Settings.AdBlockAllowlist.ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (site.IsOn) list.Remove(uri!.Host); else list.Add(uri!.Host);
            _vm.Settings = SettingsValidator.Validate(_vm.Settings with { AdBlockAllowlist = list.ToArray() });
            await SaveSettingsSafeAsync();
            CurrentWebView()?.Reload();
        };
        panel.Children.Add(global); panel.Children.Add(site);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var reset = new Button { Content = "Reset site data", CornerRadius = new(8), IsEnabled = hasOrigin };
        reset.Click += async (_, _) => await ResetCurrentSiteAsync();
        var update = new Button { Content = "Update filters", CornerRadius = new(8) };
        update.Click += async (_, _) => await UpdateContentFiltersAsync();
        actions.Children.Add(reset); actions.Children.Add(update); panel.Children.Add(actions);
        var flyout = new Flyout { Content = panel, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
        flyout.ShowAt(_shield);
    }

    private async Task UpdateContentFiltersAsync()
    {
        if (_vm.Settings.FilterListUrls.Length == 0) { ShowStatus("Add at least one filter-list URL in Settings.", InfoBarSeverity.Warning); return; }
        ShowStatus("Updating content filters…", InfoBarSeverity.Informational, 15000);
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var lists = new List<string>();
            foreach (var url in _vm.Settings.FilterListUrls)
            {
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is > 20_000_000) throw new InvalidDataException("Filter list is too large.");
                var content = await response.Content.ReadAsStringAsync();
                if (content.Length > 20_000_000) throw new InvalidDataException("Filter list is too large.");
                lists.Add(content);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(_paths.FilterListPath)!);
            await File.WriteAllTextAsync(_paths.FilterListPath, string.Join(Environment.NewLine, lists));
            await LoadContentBlockRulesAsync();
            ShowStatus($"Filters updated · {_contentBlockRules.NetworkRuleCount:N0} network rules", InfoBarSeverity.Success, 6000);
            CurrentWebView()?.Reload();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or InvalidDataException)
        {
            ShowStatus("Filter update failed. The existing local rules are still active.", InfoBarSeverity.Error, 7000);
        }
    }

    private async Task ResetCurrentSiteAsync()
    {
        var web = CurrentWebView();
        if (web?.Source is not { } source || source.Scheme is not ("http" or "https")) return;
        var origin = source.GetLeftPart(UriPartial.Authority);
        if (!await ConfirmAsync("Reset this site?", $"Clear cookies, storage, and saved permission decisions for {source.Host}?", "Reset site")) return;
        try
        {
            var cookies = await web.CoreWebView2.CookieManager.GetCookiesAsync(origin);
            foreach (var cookie in cookies) web.CoreWebView2.CookieManager.DeleteCookie(cookie);
        }
        catch { }
        try { await web.ExecuteScriptAsync("(async()=>{try{localStorage.clear();sessionStorage.clear();}catch{}try{for(const key of await caches.keys())await caches.delete(key);}catch{}try{if(indexedDB.databases)for(const db of await indexedDB.databases())if(db.name)indexedDB.deleteDatabase(db.name);}catch{}})()"); } catch { }
        if (!_isPrivate) await _permissions.DeleteOriginAsync(origin);
        web.Reload();
        ShowStatus($"Site data reset for {source.Host}", InfoBarSeverity.Success);
    }
}
