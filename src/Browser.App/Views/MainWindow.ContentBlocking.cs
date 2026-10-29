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
    private static readonly SemaphoreSlim FilterListUpdateGate = new(1, 1);
    private static DateTimeOffset _lastQuietFilterUpdateAttemptUtc = DateTimeOffset.MinValue;

    private async Task LoadContentBlockRulesAsync()
    {
        _contentBlockRules = await ContentFilterRuleSetCache.LoadAsync(
            _paths.FilterListPath, _paths.FilterListPath + ".bak", _windowLifetimeCts.Token);
        if (!_isPrivate)
        {
            try
            {
                var saved = await _appState.GetAsync("browser.elementHideRules");
                var restored = string.IsNullOrWhiteSpace(saved) ? [] : JsonSerializer.Deserialize<Browser.Core.Privacy.ElementHideRule[]>(saved) ?? [];
                _elementHideRules.Clear();
                _elementHideRules.AddRange(Browser.Core.Privacy.ElementHideRuleSet.Normalize(restored));
            }
            catch { _elementHideRules.Clear(); }
        }
    }

    internal void ApplySharedContentFilterUpdate(ContentBlockRuleSet rules)
    {
        if (_isWindowClosed) return;
        _contentBlockRules = rules;
        try { CurrentWebView()?.Reload(); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Filter refresh navigation failed: {ex.GetType().Name}"); }
    }

    private async Task EnsureContentFiltersAvailableAsync()
    {
        // On first run there is no downloaded list, which made the old tiny fallback
        // look like ad blocking was broken. These are public static filter lists;
        // no page URL, cookie, history, or account information is sent.
        if (!_vm.Settings.AdBlockingEnabled || _vm.Settings.FilterListUrls.Length == 0) return;
        if (File.Exists(_paths.FilterListPath))
        {
            var last = await _appState.GetAsync("browser.filters.updatedAt");
            if (DateTimeOffset.TryParse(last, out var updated) && DateTimeOffset.UtcNow - updated < TimeSpan.FromHours(24)) return;
        }
        await UpdateContentFiltersAsync(quiet: true);
    }

    private void OnWebResourceRequested(BrowserTab tab, CoreWebView2 core, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!_vm.Settings.AdBlockingEnabled) return;
        var isSubdocument = false;
        if (e.ResourceContext == CoreWebView2WebResourceContext.Document)
        {
            try { isSubdocument = e.Request.Headers.GetHeader("Sec-Fetch-Dest") is "iframe" or "frame"; } catch { }
            if (!isSubdocument) return; // Never replace the user's top-level navigation with a blocked page.
        }
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var resource) || IsContentBlockingAllowedForSite(tab.Url)) return;
        var type = e.ResourceContext switch
        {
            CoreWebView2WebResourceContext.Script => "script",
            CoreWebView2WebResourceContext.Image => "image",
            CoreWebView2WebResourceContext.Stylesheet => "stylesheet",
            CoreWebView2WebResourceContext.Font => "font",
            CoreWebView2WebResourceContext.Media => "media",
            CoreWebView2WebResourceContext.Document => "subdocument",
            CoreWebView2WebResourceContext.XmlHttpRequest => "xmlhttprequest",
            CoreWebView2WebResourceContext.Fetch => "fetch",
            CoreWebView2WebResourceContext.Ping => "ping",
            CoreWebView2WebResourceContext.Other => "other",
            _ => "other"
        };
        var pageHost = Uri.TryCreate(tab.Url, UriKind.Absolute, out var pageUri) ? pageUri.Host : string.Empty;
        if (!_contentBlockRules.ShouldBlock(resource, pageHost, type)) return;
        e.Response = core.Environment.CreateWebResourceResponse(new InMemoryRandomAccessStream(), 403, "Blocked by Sutra", "Content-Type: text/plain\r\nCache-Control: no-store");
        _blockedRequestCounts[tab.Id] = _blockedRequestCounts.GetValueOrDefault(tab.Id) + 1;
        if (tab.Id == _vm.SelectedTab?.Id) DispatcherQueue.TryEnqueue(() => UpdateShieldState(tab));
    }

    private async Task ApplyCosmeticFiltersAsync(BrowserTab tab, WebView2 web)
    {
        if (!_vm.Settings.AdBlockingEnabled || !_vm.Settings.CosmeticFilteringEnabled || IsContentBlockingAllowedForSite(tab.Url)) return;
        if (!Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        var selectors = _contentBlockRules.CosmeticSelectorsFor(uri.Host)
            .Concat(Browser.Core.Privacy.ElementHideRuleSet.ForHost(_elementHideRules, uri.Host))
            .Distinct(StringComparer.Ordinal).Take(1200).ToArray();
        var selectorsJson = JsonSerializer.Serialize(selectors);
        try
        {
            await web.ExecuteScriptAsync($"(()=>{{let s=document.getElementById('__sutra_content_filters');if(!s){{s=document.createElement('style');s.id='__sutra_content_filters';(document.head||document.documentElement).appendChild(s);}}const valid={selectorsJson}.filter(x=>{{try{{return CSS.supports('selector('+x+')')}}catch{{return false}}}});s.textContent=valid.length?valid.join(',')+'{{display:none!important}}':'';}})()");
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
        Flyout? flyout = null;
        var picker = new Button { Content = "Hide an element on this site", CornerRadius = new(8), IsEnabled = hasOrigin && !_isPrivate };
        picker.Click += async (_, _) => { flyout?.Hide(); await StartElementPickerAsync(); };
        panel.Children.Add(picker);
        IReadOnlyList<string> hidden = hasOrigin ? Browser.Core.Privacy.ElementHideRuleSet.ForHost(_elementHideRules, uri!.Host) : Array.Empty<string>();
        if (hidden.Count > 0)
        {
            var undo = new Button { Content = $"Undo last hidden element ({hidden.Count})", CornerRadius = new(8), IsEnabled = !_isPrivate };
            undo.Click += async (_, _) => await UndoLastHiddenElementAsync(uri!.Host);
            panel.Children.Add(undo);
        }
        flyout = new Flyout { Content = panel, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
        flyout.ShowAt(_shield);
    }

    private async Task UpdateContentFiltersAsync(bool quiet = false)
    {
        if (_vm.Settings.FilterListUrls.Length == 0) { if (!quiet) ShowStatus("Add at least one filter-list URL in Settings.", InfoBarSeverity.Warning); return; }
        try { await FilterListUpdateGate.WaitAsync(_windowLifetimeCts.Token); }
        catch (OperationCanceledException) { return; }
        try
        {
            // The filter file is shared by browser windows. After the first quiet
            // startup refresh succeeds, later windows should reuse that download.
            if (quiet)
            {
                var now = DateTimeOffset.UtcNow;
                if (IsFilterFileFresh() || now - _lastQuietFilterUpdateAttemptUtc < TimeSpan.FromHours(1)) return;
                _lastQuietFilterUpdateAttemptUtc = now;
            }
            await UpdateContentFiltersCoreAsync(quiet);
        }
        finally { FilterListUpdateGate.Release(); }
    }

    private bool IsFilterFileFresh()
    {
        try
        {
            return File.Exists(_paths.FilterListPath) &&
                DateTime.UtcNow - File.GetLastWriteTimeUtc(_paths.FilterListPath) < TimeSpan.FromHours(24);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }

    private async Task UpdateContentFiltersCoreAsync(bool quiet)
    {
        if (!quiet) ShowStatus("Updating content filters…", InfoBarSeverity.Informational, 15000);
        string? temp = null;
        string? backupTemp = null;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var lists = new List<string>();
            foreach (var url in _vm.Settings.FilterListUrls)
            {
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is > 20_000_000) throw new InvalidDataException("Filter list is too large.");
                await using var stream = await response.Content.ReadAsStreamAsync();
                using var buffer = new MemoryStream();
                var chunk = new byte[64 * 1024];
                while (true)
                {
                    var read = await stream.ReadAsync(chunk, _windowLifetimeCts.Token);
                    if (read == 0) break;
                    if (buffer.Length + read > 20_000_000) throw new InvalidDataException("Filter list is too large.");
                    buffer.Write(chunk, 0, read);
                }
                var content = System.Text.Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
                lists.Add(content);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(_paths.FilterListPath)!);
            var combined = string.Join(Environment.NewLine, lists);
            var candidateNetworkRules = await Task.Run(
                () => ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules.Concat(combined.Split('\n'))).NetworkRuleCount,
                _windowLifetimeCts.Token);
            var baseRules = ContentFilterRuleSetCache.BuiltIn.NetworkRuleCount;
            if (candidateNetworkRules < baseRules + 100) throw new InvalidDataException("Downloaded filter lists did not contain enough valid network rules.");
            temp = _paths.FilterListPath + ".new-" + Guid.NewGuid().ToString("N");
            await File.WriteAllTextAsync(temp, combined);
            var backupPath = _paths.FilterListPath + ".bak";
            var activeSet = await ContentFilterRuleSetCache.LoadAsync(_paths.FilterListPath, backupPath, _windowLifetimeCts.Token);
            var activeRules = activeSet.NetworkRuleCount;
            if (activeRules > baseRules + Browser.Core.Privacy.ContentFilterRecoveryPolicy.MinimumAddedNetworkRules)
            {
                backupTemp = backupPath + ".new-" + Guid.NewGuid().ToString("N");
                File.Copy(_paths.FilterListPath, backupTemp, overwrite: false);
                File.Move(backupTemp, backupPath, overwrite: true);
                backupTemp = null;
            }
            File.Move(temp, _paths.FilterListPath, overwrite: true);
            temp = null;
            await LoadContentBlockRulesAsync();
            await _appState.SetAsync("browser.filters.updatedAt", DateTimeOffset.UtcNow.ToString("O"));
            if (!quiet) ShowStatus($"Filters updated · {_contentBlockRules.NetworkRuleCount:N0} network rules", InfoBarSeverity.Success, 6000);
            foreach (var window in ((App)Application.Current).BrowserWindows)
                window.ApplySharedContentFilterUpdate(_contentBlockRules);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or InvalidDataException)
        {
            try { if (temp is not null && File.Exists(temp)) File.Delete(temp); } catch { }
            try { if (backupTemp is not null && File.Exists(backupTemp)) File.Delete(backupTemp); } catch { }
            if (!quiet) ShowStatus("Filter update failed. The last known good rules are still active.", InfoBarSeverity.Error, 7000);
        }
    }

    private async Task StartElementPickerAsync()
    {
        var tab = _vm.SelectedTab;
        var web = CurrentWebView();
        if (_isPrivate || tab is null || web?.CoreWebView2 is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        _elementPickerTabId = tab.Id;
        _elementPickerHost = uri.Host;
        _elementPickerOrigin = uri.GetLeftPart(UriPartial.Authority);
        _elementPickerNonce = Guid.NewGuid().ToString("N");
        const string pickerScript = """
            (()=>{
              if(window.__sutraElementPicker)window.__sutraElementPicker.cleanup();
              const token=__SUTRA_PICKER_NONCE__;
              let last=null,oldOutline='';
              const root=document.documentElement,oldCursor=root.style.cursor;
              root.style.cursor='crosshair';
              const overlay=document.createElement('div');overlay.id='__sutra_element_picker';
              Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',pointerEvents:'none',background:'transparent'});
              const selectorFor=el=>{
                const parts=[];
                for(let n=el;n&&n.nodeType===1&&n!==document.body&&parts.length<5;n=n.parentElement){
                  let p=n.tagName.toLowerCase();
                  if(n.id&&/^[\w-]{1,80}$/.test(n.id)){p+='#'+n.id;parts.unshift(p);break;}
                  const cs=Array.from(n.classList||[]).filter(x=>/^[\w-]{1,48}$/.test(x)).slice(0,2);
                  if(cs.length)p+='.'+cs.join('.');
                  if(n.parentElement){const same=Array.from(n.parentElement.children).filter(x=>x.tagName===n.tagName);if(same.length>1)p+=':nth-of-type('+(same.indexOf(n)+1)+')';}
                  parts.unshift(p);
                }
                return parts.join(' > ');
              };
              const restore=()=>{if(last)last.style.outline=oldOutline;};
              const cleanup=()=>{
                restore();root.style.cursor=oldCursor;overlay.remove();
                document.removeEventListener('mousemove',move,true);
                document.removeEventListener('click',click,true);
                window.removeEventListener('keydown',key,true);window.__sutraElementPicker=null;
              };
              const move=e=>{const el=document.elementFromPoint(e.clientX,e.clientY);if(el===last)return;restore();last=el&&el!==overlay?el:null;oldOutline=last?last.style.outline:'';if(last)last.style.outline='3px solid #7c5cff';};
              const click=e=>{
                if(!e.isTrusted)return;
                const el=document.elementFromPoint(e.clientX,e.clientY);if(!el||el===overlay)return;
                e.preventDefault();e.stopImmediatePropagation();const selector=selectorFor(el);cleanup();
                window.chrome.webview.postMessage({kind:'element-picker-selected',token,selector});
              };
              const key=e=>{if(e.isTrusted&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cleanup();window.chrome.webview.postMessage({kind:'element-picker-cancelled',token});}};
              document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);window.addEventListener('keydown',key,true);
              window.__sutraElementPicker={cleanup};(document.documentElement||document.body).appendChild(overlay);
            })();
            """;
        try { await web.ExecuteScriptAsync(pickerScript.Replace("__SUTRA_PICKER_NONCE__", JsonSerializer.Serialize(_elementPickerNonce), StringComparison.Ordinal)); ShowStatus("Click an element to hide it on this site. Press Escape to cancel.", InfoBarSeverity.Informational, 8000); }
        catch { ClearElementPickerState(); ShowStatus("The element picker could not start on this page.", InfoBarSeverity.Warning); }
    }

    private void ClearElementPickerState()
    {
        _elementPickerTabId = null; _elementPickerHost = null; _elementPickerOrigin = null; _elementPickerNonce = null;
    }

    private bool IsExpectedElementPickerMessage(BrowserTab tab, string source, string token) =>
        !_isPrivate && _elementPickerTabId == tab.Id && tab.Id == _vm.SelectedTab?.Id &&
        _elementPickerNonce is not null && string.Equals(token, _elementPickerNonce, StringComparison.Ordinal) &&
        Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" &&
        string.IsNullOrEmpty(uri.UserInfo) && string.Equals(_elementPickerOrigin, uri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);

    private async Task SaveHiddenElementAsync(BrowserTab tab, string source, string token, string selector)
    {
        if (!IsExpectedElementPickerMessage(tab, source, token) || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            !string.Equals(_elementPickerHost, uri.Host, StringComparison.OrdinalIgnoreCase) ||
            !Browser.Core.Privacy.ElementHideRuleSet.IsSafeSelector(selector)) return;
        ClearElementPickerState();
        var next = Browser.Core.Privacy.ElementHideRuleSet.Add(_elementHideRules, uri.Host, selector);
        _elementHideRules.Clear();
        _elementHideRules.AddRange(next);
        await _appState.SetAsync("browser.elementHideRules", JsonSerializer.Serialize(_elementHideRules));
        if (_webViews.TryGetValue(tab.Id, out var web)) await ApplyCosmeticFiltersAsync(tab, web);
        ShowStatus("Element hidden on this site. Undo it from the privacy menu.", InfoBarSeverity.Success, 5500);
    }

    private async Task UndoLastHiddenElementAsync(string host)
    {
        var last = Browser.Core.Privacy.ElementHideRuleSet.ForHost(_elementHideRules, host).LastOrDefault();
        if (last is null) return;
        var next = Browser.Core.Privacy.ElementHideRuleSet.Remove(_elementHideRules, host, last);
        _elementHideRules.Clear(); _elementHideRules.AddRange(next);
        await _appState.SetAsync("browser.elementHideRules", JsonSerializer.Serialize(_elementHideRules));
        if (_vm.SelectedTab is { } tab && _webViews.TryGetValue(tab.Id, out var web)) await ApplyCosmeticFiltersAsync(tab, web);
        ShowStatus("Last hidden element restored.", InfoBarSeverity.Success);
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
