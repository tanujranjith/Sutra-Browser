using System.Text.Json;
using Browser.Core.Tabs;
using Browser.Platform.Windows.WebView;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class MainWindow
{
    private sealed record VideoMiniPlayer(Window Window, Grid Host, WebView2 View, string Marker,
        Windows.Foundation.TypedEventHandler<CoreWebView2, CoreWebView2NavigationStartingEventArgs> NavigationStarting)
    {
        public NativeWindowResizeLimits? ResizeLimits { get; set; }
    }
    private readonly Dictionary<Guid, VideoMiniPlayer> _videoMiniPlayers = [];

    private async Task ShowVideoMiniPlayerAsync(BrowserTab tab, MediaSnapshot media)
    {
        if (_videoMiniPlayers.TryGetValue(tab.Id, out var existing))
        {
            existing.Window.Activate();
            return;
        }
        if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) return;
        var marker = "data-sutra-video-" + Guid.NewGuid().ToString("N");
        // Keep the original media element, document, cookies, and playback state.
        // Only presentation changes; no media URL or credential is copied out.
        var script = $$"""
            (() => {
              const video = [...document.querySelectorAll('video')].find(v => v.__sutraMediaId === {{JsonSerializer.Serialize(media.Id)}});
              if (!video) return false;
              if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              const marker = {{JsonSerializer.Serialize(marker)}};
              video.setAttribute(marker, video.controls ? 'controls' : '');
              video.controls = true;
              for (let p = video.parentElement; p; p = p.parentElement) p.setAttribute(marker + '-parent', '');
              const style = document.createElement('style');
              style.id = marker;
              style.textContent = `
                html, body { background: black !important; width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; scrollbar-width: none !important; transform: none !important; filter: none !important; perspective: none !important; contain: none !important; }
                html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
                body * { visibility: hidden !important; }
                [${marker}-parent]:not(html):not(body) { display: block !important; opacity: 1 !important; content-visibility: visible !important; transform: none !important; filter: none !important; perspective: none !important; contain: none !important; clip-path: none !important; overflow: visible !important; }
                video[${marker}] { visibility: visible !important; opacity: 1 !important; display: block !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; object-fit: contain !important; z-index: 2147483647 !important; }
                #${marker}-overlay { all: initial !important; position: fixed !important; inset: 0 0 auto !important; height: 44px !important; visibility: visible !important; z-index: 2147483647 !important; }
              `;
              document.documentElement.appendChild(style);
              const overlay=document.createElement('div');
              overlay.id=marker+'-overlay';
              const shadow=overlay.attachShadow({mode:'open'});
              shadow.innerHTML=`<style>
                :host{color-scheme:dark}*{box-sizing:border-box}.bar{display:flex;align-items:center;gap:4px;height:44px;padding:5px 7px;background:linear-gradient(#080d18d9,transparent);opacity:0;transition:opacity .18s;pointer-events:none}
                :host([data-visible]) .bar,.bar:focus-within{opacity:1;pointer-events:auto}button{display:grid;place-items:center;flex-shrink:0;width:30px;height:30px;padding:0;border:0;border-radius:9px;background:#101827b8;color:#fff;cursor:pointer}button svg{display:block;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}button:hover{background:#6252f5}button:focus-visible{outline:2px solid white;outline-offset:1px}.drag{flex:1;min-width:0;overflow:hidden;justify-content:start;background:transparent;cursor:move}.close:hover{background:#b4233b}@media(prefers-reduced-motion:reduce){.bar{transition:none} }
              </style><div class="bar"><button class="drag" title="Drag to move" aria-label="Drag mini player"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" stroke-width="3"/></svg></button><button class="return" title="Return to tab" aria-label="Return video to tab"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4H4v16h16v-9M13 3h8v8m0-8-11 11"/></svg></button><button class="close" title="Close mini player" aria-label="Close mini player"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>`;
              document.documentElement.appendChild(overlay);
              const abort=new AbortController();let timer;
              const reveal=()=>{overlay.setAttribute('data-visible','');clearTimeout(timer);timer=setTimeout(()=>{if(!overlay.matches(':hover')&&!shadow.activeElement)overlay.removeAttribute('data-visible')},1600)};
              document.addEventListener('pointermove',reveal,{capture:true,passive:true,signal:abort.signal});
              const send=action=>window.chrome?.webview?.postMessage({kind:'mini-player-window',token:marker,action});
              shadow.querySelector('.drag').addEventListener('pointerdown',e=>{if(e.isTrusted&&e.button===0){e.preventDefault();send('drag')} },{signal:abort.signal});
              shadow.querySelector('.return').addEventListener('click',e=>{if(e.isTrusted)send('return')},{signal:abort.signal});
              shadow.querySelector('.close').addEventListener('click',e=>{if(e.isTrusted)send('close')},{signal:abort.signal});
              overlay.__sutraCleanup=()=>{abort.abort();clearTimeout(timer);overlay.remove()};
              reveal();
              return true;
            })()
            """;
        var window = new Window { Title = "Sutra — Video mini-player" };
        var host = new Grid();
        window.Content = host;
        Windows.Foundation.TypedEventHandler<CoreWebView2, CoreWebView2NavigationStartingEventArgs> onNavigation = (_, _) =>
            ObserveUiCallback("Video mini-player navigation", () => CloseVideoMiniPlayerAsync(tab.Id));
        var player = new VideoMiniPlayer(window, host, web, marker, onNavigation);
        _videoMiniPlayers.Add(tab.Id, player);
        window.AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
        ConfigureVideoMiniPlayerPresenter(window);
        var workArea = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var width = Math.Min(320, workArea.Width);
        var height = Math.Min(180, workArea.Height);
        var insetX = Math.Min(16, Math.Max(0, workArea.Width - width));
        var insetY = Math.Min(16, Math.Max(0, workArea.Height - height));
        var initialBounds = new Windows.Graphics.RectInt32(
            workArea.X + insetX, workArea.Y + workArea.Height - height - insetY, width, height);
        window.AppWindow.MoveAndResize(initialBounds);
        window.AppWindow.Closing += (_, args) =>
        {
            if (!_videoMiniPlayers.ContainsKey(tab.Id)) return;
            args.Cancel = true;
            ObserveUiCallback("Return video to tab", () => CloseVideoMiniPlayerAsync(tab.Id));
        };
        try
        {
            DetachWebView(web);
            host.Children.Add(web);
            window.Activate();
            player.ResizeLimits = new NativeWindowResizeLimits(WinRT.Interop.WindowNative.GetWindowHandle(window), 96, 64);
            // Apply again after WinUI's initial minimum-size handling is overridden.
            window.AppWindow.MoveAndResize(initialBounds);
            if (await web.ExecuteScriptAsync(script).AsTask().WaitAsync(TimeSpan.FromSeconds(3), _windowLifetimeCts.Token) != "true")
            {
                await CloseVideoMiniPlayerAsync(tab.Id);
                ShowStatus("This video is no longer available.", InfoBarSeverity.Warning);
                return;
            }
            if (!_videoMiniPlayers.TryGetValue(tab.Id, out var current) || !ReferenceEquals(current, player)) return;
            web.CoreWebView2.NavigationStarting += onNavigation;
            if (_isWindowClosed || !_vm.Tabs.Contains(tab))
            {
                await CloseVideoMiniPlayerAsync(tab.Id, restoreTab: false);
                return;
            }
            // Leave the browser available while this tab plays in its own window.
            if (_vm.SelectedTab?.Id == tab.Id)
            {
                var next = _vm.Tabs.FirstOrDefault(t => t.Id != tab.Id) ?? NewTab(activate: false);
                await ActivateTabAsync(next);
            }
        }
        catch
        {
            await CloseVideoMiniPlayerAsync(tab.Id);
            throw;
        }
    }

    private static void ConfigureVideoMiniPlayerPresenter(Window window)
    {
        if (window.AppWindow.Presenter is not OverlappedPresenter presenter) return;
        presenter.IsAlwaysOnTop = true;
        presenter.IsResizable = true;
        presenter.IsMaximizable = true;
        presenter.IsMinimizable = true;
        presenter.SetBorderAndTitleBar(true, false);
    }

    private async Task CloseVideoMiniPlayerAsync(Guid tabId, bool restoreTab = true)
    {
        if (!_videoMiniPlayers.Remove(tabId, out var player)) return;
        if (player.View.CoreWebView2 is { } core) core.NavigationStarting -= player.NavigationStarting;
        // Detach before closing the native window so the live controller survives.
        player.Host.Children.Remove(player.View);
        player.ResizeLimits?.Dispose();
        player.Window.Close();
        if (_isWindowClosed || !_webViews.TryGetValue(tabId, out var current) || !ReferenceEquals(current, player.View)) return;
        try
        {
            var marker = JsonSerializer.Serialize(player.Marker);
            await player.View.ExecuteScriptAsync($$"""
                (() => {
                  const marker = {{marker}};
                  document.getElementById(marker+'-overlay')?.__sutraCleanup?.();
                  document.getElementById(marker)?.remove();
                  for (const video of document.querySelectorAll('video[' + marker + ']')) {
                    video.controls = video.getAttribute(marker) === 'controls';
                    video.removeAttribute(marker);
                  }
                  for (const parent of document.querySelectorAll('[' + marker + '-parent]')) parent.removeAttribute(marker + '-parent');
                })()
                """).AsTask().WaitAsync(TimeSpan.FromSeconds(2), _windowLifetimeCts.Token);
        }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Video presentation cleanup: {ex.GetType().Name}"); }
        if (restoreTab && !_isWindowClosed && FindTab(tabId) is { } tab)
            await ActivateTabAsync(tab);
    }
}
