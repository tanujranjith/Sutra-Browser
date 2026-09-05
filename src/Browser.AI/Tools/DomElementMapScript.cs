namespace Browser.AI.Tools;

public static class DomElementMapScript
{
    public const string Build = """
        (() => {
          const visible = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
          const nodes = [...document.querySelectorAll('a,button,input:not([type=password]),select,textarea,[role],[tabindex]')]
            .filter(visible).slice(0,300);
          return JSON.stringify(nodes.map((e,i) => {
            const id = 'e' + i; e.dataset.sutraElementId=id; const r=e.getBoundingClientRect();
            return { id, tag:e.tagName.toLowerCase(), role:e.getAttribute('role')||'',
              name:e.getAttribute('aria-label')||e.getAttribute('title')||'',
              text:(e.innerText||e.value||'').trim().slice(0,300), inputType:e.type||'',
              enabled:!e.disabled, checked:!!e.checked, selected:!!e.selected,
              rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)} };
          }));
        })();
        """;

    public static string Click(string id) => $"(() => {{ const e=document.querySelector('[data-sutra-element-id=\"{EscapeId(id)}\"]'); if(!e) return 'missing'; e.click(); return 'clicked'; }})()";
    private static string EscapeId(string id) => new string(id.Where(char.IsLetterOrDigit).Take(32).ToArray());
}
