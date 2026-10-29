using System.Text.Json;
using Browser.Core.Media;
using Browser.Core.Tabs;
using Browser.Platform.Windows.WebView;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task HandleVideoOverlayMessageAsync(BrowserTab tab, string source, JsonElement message)
    {
        if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) return;
        var kind = message.GetProperty("kind").GetString();
        var token = kind == "mini-player-window" && _videoMiniPlayers.TryGetValue(tab.Id, out var mini)
            ? mini.Marker : NavigationState(web).VideoHoverToken;
        if (!VideoOverlayMessagePolicy.TryRead(message, source, web.CoreWebView2.Source, token, out var request)) return;
        var navigation = NavigationState(web);
        var now = DateTimeOffset.UtcNow;
        if (now - navigation.LastVideoOverlayAction < TimeSpan.FromMilliseconds(200)) return;
        navigation.LastVideoOverlayAction = now;
        if (request!.Kind == "video-mini-player")
        {
            if (_vm.SelectedTab?.Id != tab.Id && !_splitTabIds.Contains(tab.Id)) return;
            var media = await QueryVideoByIdAsync(web, request.MediaId!);
            if (media is not null && IsCurrentTabWebView(tab, web)) await ShowMiniPlayerAsync(tab, media);
            return;
        }
        if (!_videoMiniPlayers.TryGetValue(tab.Id, out var player)) return;
        switch (request.Action)
        {
            case "drag": NativeWindowResizeLimits.BeginMove(WinRT.Interop.WindowNative.GetWindowHandle(player.Window)); break;
            case "return": await CloseVideoMiniPlayerAsync(tab.Id); Activate(); break;
            case "close": await CloseVideoMiniPlayerAsync(tab.Id, restoreTab: false); break;
        }
    }

    private async Task<MediaSnapshot?> QueryVideoByIdAsync(Microsoft.UI.Xaml.Controls.WebView2 web, string id)
    {
        var script = $$"""
            (()=>{
              const media=[...document.querySelectorAll('video')].slice(0,64).find(video=>video.__sutraMediaId==={{JsonSerializer.Serialize(id)}});
              if(!media)return null;
              return {id:media.__sutraMediaId,kind:'video',title:String(media.getAttribute('aria-label')||media.title||document.title||'Video'),artist:'',currentTime:Number.isFinite(media.currentTime)?media.currentTime:0,duration:Number.isFinite(media.duration)?media.duration:null,paused:media.paused,muted:media.muted||media.volume===0,isControllable:true};
            })()
            """;
        try { return JsonSerializer.Deserialize<MediaSnapshot>(await web.ExecuteScriptAsync(script), MediaJsonOptions); }
        catch { return null; }
    }

    private const string VideoHoverButtonScript = """
        (()=>{
          if(window.top!==window||!['https:','http:','file:'].includes(location.protocol))return;
          const token=__SUTRA_VIDEO_TOKEN__;
          const install=()=>{
            const host=document.createElement('div');
            host.setAttribute('data-sutra-video-shortcut','');
            host.style.cssText='all:initial!important;position:fixed!important;inset:auto!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;display:none!important;visibility:visible!important;';
            const shadow=host.attachShadow({mode:'open'});
            shadow.innerHTML=`<style>:host{color-scheme:dark}button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 10px;border:1px solid #ffffff45;border-radius:9px;background:#0d1428ed;box-shadow:0 2px 10px #0005;color:white;font:600 12px 'Segoe UI',sans-serif;cursor:pointer}button:hover{background:#6252f5}button:focus-visible{outline:2px solid white;outline-offset:2px}svg{width:15px;height:15px;display:block}</style><button type="button" aria-label="Open video in mini player" title="Open mini player"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg><span>Mini</span></button>`;
            document.documentElement.appendChild(host);
            let current=null,pending=false,lastX=0,lastY=0;
            const hide=()=>{host.style.setProperty('display','none','important');current=null};
            const place=()=>{
              if(!current?.isConnected||document.querySelector('[id^="data-sutra-video-"][id$="-overlay"]'))return hide();
              const rect=current.getBoundingClientRect();
              if(rect.width<80||rect.height<45||rect.bottom<=0||rect.top>=innerHeight)return hide();
              const right=Math.min(innerWidth-6,rect.right-10),top=Math.max(6,rect.top+10);
              host.style.setProperty('left',Math.max(4,right-78)+'px','important');host.style.setProperty('top',top+'px','important');host.style.setProperty('display','block','important');
            };
            const update=()=>{
              pending=false;
              if(host.matches(':hover')||shadow.activeElement)return place();
              const videos=[...document.querySelectorAll('video')].slice(0,64);
              current=videos.find(video=>{
                if(!video.getClientRects().length)return false;
                const rect=video.getBoundingClientRect();
                if(lastX<rect.left||lastX>rect.right||lastY<rect.top||lastY>rect.bottom)return false;
                for(let node=video;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false}
                return true;
              });
              if(current)place();else hide();
            };
            document.addEventListener('pointermove',e=>{lastX=e.clientX;lastY=e.clientY;if(!pending){pending=true;requestAnimationFrame(update)}},{capture:true,passive:true});
            document.addEventListener('scroll',()=>{if(current)place()},{capture:true,passive:true});
            window.addEventListener('resize',()=>{if(current)place()},{passive:true});
            document.addEventListener('pointerleave',hide);
            shadow.querySelector('button').addEventListener('click',e=>{
              if(!e.isTrusted||!current?.isConnected)return;
              e.preventDefault();e.stopPropagation();
              if(!current.__sutraMediaId){window.__sutraMediaNextId=window.__sutraMediaNextId||1;Object.defineProperty(current,'__sutraMediaId',{value:'sutra-'+window.__sutraMediaNextId++,configurable:true})}
              window.chrome?.webview?.postMessage({kind:'video-mini-player',token,mediaId:current.__sutraMediaId});hide();
            });
          };
          if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
        })()
        """;
}
