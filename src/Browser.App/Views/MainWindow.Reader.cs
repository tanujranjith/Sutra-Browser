using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private string ReaderOptionsJson() => JsonSerializer.Serialize(new
    {
        font = _vm.Settings.ReaderFontSize, width = _vm.Settings.ReaderWidth, theme = _vm.Settings.ReaderAppearance
    });

    private async Task ToggleReaderModeAsync()
    {
        var tab = _vm.SelectedTab; var web = CurrentWebView();
        if (tab is null || web?.CoreWebView2 is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        { ShowStatus("Reader mode is available on web articles."); return; }
        try
        {
            var result = await web.ExecuteScriptAsync(ReaderViewScript.Replace("__SUTRA_READER_OPTIONS__", ReaderOptionsJson(), StringComparison.Ordinal));
            if (result == "\"opened\"") { _readerTabs.Add(tab.Id); ShowStatus("Reader view · adjust appearance from the command palette · Escape returns to the page", InfoBarSeverity.Success); }
            else if (result == "\"closed\"") { _readerTabs.Remove(tab.Id); ShowStatus("Returned to the original page"); }
            else ShowStatus("No readable article was found on this page.");
        }
        catch { ShowStatus("Reader mode could not process this page.", InfoBarSeverity.Warning); }
    }

    private async Task ShowReaderSettingsAsync()
    {
        var size = new Slider { Header = "Text size", Minimum = 16, Maximum = 28, StepFrequency = 1, Value = _vm.Settings.ReaderFontSize };
        var width = new Slider { Header = "Reading width", Minimum = 560, Maximum = 960, StepFrequency = 40, Value = _vm.Settings.ReaderWidth };
        var appearance = new ComboBox { Header = "Appearance", ItemsSource = new[] { "system", "light", "dark", "sepia" }, SelectedItem = _vm.Settings.ReaderAppearance, HorizontalAlignment = HorizontalAlignment.Stretch };
        var dialog = new ContentDialog { Title = "Reader appearance", Content = new StackPanel { Spacing = 18, MinWidth = 280, Children = { size, width, appearance } }, PrimaryButtonText = "Apply", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || _isWindowClosed) return;
        _vm.Settings = _vm.Settings with { ReaderFontSize = (int)size.Value, ReaderWidth = (int)width.Value, ReaderAppearance = appearance.SelectedItem?.ToString() ?? "system" };
        if (!_isPrivate) await SaveSettingsSafeAsync();
        if (CurrentWebView() is { } web)
            try { await web.ExecuteScriptAsync($"window.__sutraReader?.apply({ReaderOptionsJson()})"); } catch { }
        ShowStatus(_isPrivate ? "Reader preferences changed for this private window" : "Reader preferences saved", InfoBarSeverity.Success);
    }

    private const string ReaderViewScript = """
        (()=>{
          if(window.top!==window)return 'unavailable';
          if(window.__sutraReader?.active){window.__sutraReader.close();return 'closed';}
          const source=document.querySelector('article')||document.querySelector('main');
          const body=document.body;
          if(!source||!body)return 'unavailable';
          const skip='script,style,noscript,nav,aside,header,footer,form,input,textarea,select,button,iframe,canvas,svg,[contenteditable],[hidden],[aria-hidden="true"]';
          const walker=document.createTreeWalker(source,NodeFilter.SHOW_TEXT);
          const blocks=[];let node,visited=0,total=0,previous=null;
          while((node=walker.nextNode())&&visited++<50000&&total<250000){
            const parent=node.parentElement;
            if(!parent||parent.closest(skip)||!parent.getClientRects().length)continue;
            const style=getComputedStyle(parent);if(style.visibility==='hidden'||style.display==='none')continue;
            const text=node.textContent.replace(/\s+/g,' ').trim();if(!text)continue;
            const block=parent.closest('h1,h2,h3,h4,p,li,blockquote,pre,figcaption')||parent;
            const remaining=Math.max(0,250000-total-1);const value=text.slice(0,remaining);total+=value.length+1;
            if(previous===block)blocks[blocks.length-1].text+=' '+value;
            else{blocks.push({tag:/^H[1-4]$/.test(block.tagName)?block.tagName.toLowerCase():block.tagName==='LI'?'li':'p',text:value});previous=block;}
          }
          if(total<120)return 'unavailable';
          const title=(document.querySelector('h1')?.innerText||document.title||'Reader view').slice(0,300);
          const scroll={x:window.scrollX,y:window.scrollY},oldInert=body.inert,oldAria=body.getAttribute('aria-hidden'),oldFocus=document.activeElement;
          const host=document.createElement('div');host.id='__sutra_reader_view';
          host.style.cssText='all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;color-scheme:light dark';
          const shadow=host.attachShadow({mode:'open'});
          const style=document.createElement('style');style.textContent=`
            :host{--paper:#f7f6f2;--ink:#22232a;--muted:#626573;--line:#d6d4ce}
            @media(prefers-color-scheme:dark){:host{--paper:#111823;--ink:#e8eaf1;--muted:#a6adbc;--line:#303b4c}}
            .view{position:absolute;inset:0;overflow:auto;background:var(--paper);color:var(--ink);font:var(--size,20px)/1.8 Georgia,serif;overscroll-behavior:contain}
            .bar{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid var(--line);background:var(--paper);font:13px system-ui;z-index:1}
            .bar span{flex:1;color:var(--muted)}button,select{font:13px system-ui;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:8px;padding:7px 10px;cursor:pointer}
            button:focus-visible,select:focus-visible{outline:2px solid #8974ff;outline-offset:2px}
            article{max-width:var(--width,760px);margin:36px auto 100px;padding:0 24px}h1{font-size:2em;line-height:1.2;letter-spacing:-.025em}h2,h3,h4{line-height:1.3;margin-top:1.8em}p,li{white-space:pre-wrap;overflow-wrap:anywhere}li{margin-left:1em;display:list-item}small{font:13px system-ui;color:var(--muted)}
            @media(max-width:480px){.bar{padding:8px;gap:4px}.bar span{font-size:11px}button,select{padding:6px}article{padding:0 18px;margin-top:24px}h1{font-size:1.6em}}
          `;
          const view=document.createElement('div');view.className='view';view.setAttribute('role','document');view.setAttribute('aria-label','Reader view');
          const bar=document.createElement('div');bar.className='bar';
          const label=document.createElement('span');label.textContent='Sutra reader · '+Math.max(1,Math.ceil(total/1200))+' min';bar.append(label);
          const small=document.createElement('button');small.textContent='A−';small.setAttribute('aria-label','Smaller reader text');
          const large=document.createElement('button');large.textContent='A+';large.setAttribute('aria-label','Larger reader text');
          const theme=document.createElement('select');theme.setAttribute('aria-label','Reader appearance');
          for(const name of ['system','light','dark','sepia']){const option=document.createElement('option');option.value=name;option.textContent=name;theme.append(option);}
          const exit=document.createElement('button');exit.textContent='Return';exit.setAttribute('aria-label','Return to original page');bar.append(small,large,theme,exit);
          const article=document.createElement('article'),heading=document.createElement('h1'),origin=document.createElement('small');heading.textContent=title;origin.textContent=location.hostname;article.append(origin,heading);
          for(const block of blocks){if(block.tag==='h1'&&block.text===title)continue;const element=document.createElement(block.tag);element.textContent=block.text;article.append(element);}
          view.append(bar,article);shadow.append(style,view);
          let options=__SUTRA_READER_OPTIONS__;
          function apply(next){options={...options,...next};const size=Math.max(16,Math.min(28,Number(options.font)||20));host.style.setProperty('--size',size+'px');host.style.setProperty('--width',Math.max(560,Math.min(960,Number(options.width)||760))+'px');
            const colors={light:['#f7f6f2','#22232a','#626573','#d6d4ce'],dark:['#111823','#e8eaf1','#a6adbc','#303b4c'],sepia:['#f1e5cd','#47392d','#75614b','#d4c2a3']}[options.theme];
            ['--paper','--ink','--muted','--line'].forEach((key,i)=>colors?host.style.setProperty(key,colors[i]):host.style.removeProperty(key));theme.value=options.theme;}
          function close(){document.removeEventListener('keydown',onKey,true);host.remove();body.inert=oldInert;oldAria===null?body.removeAttribute('aria-hidden'):body.setAttribute('aria-hidden',oldAria);window.scrollTo(scroll.x,scroll.y);if(oldFocus?.isConnected)oldFocus.focus({preventScroll:true});delete window.__sutraReader;}
          function onKey(e){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}}
          exit.addEventListener('click',close);small.addEventListener('click',()=>apply({font:Math.max(16,options.font-1)}));large.addEventListener('click',()=>apply({font:Math.min(28,options.font+1)}));theme.addEventListener('change',()=>apply({theme:theme.value}));
          body.inert=true;body.setAttribute('aria-hidden','true');document.documentElement.append(host);document.addEventListener('keydown',onKey,true);
          window.__sutraReader={active:true,close,apply};apply(options);exit.focus({preventScroll:true});return 'opened';
        })()
        """;
}
