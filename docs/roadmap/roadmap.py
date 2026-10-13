import html, json, sys

# status: done | doing | next | later
DATA = {
  "stats": [("215","tests passing"),("0 / 100","fuzz seeds failing"),("~1 %","solids fuzz at 40 steps (was 22 %)"),("53","design decisions logged")],
  "phases": [
    {"name":"Engine","blurb":"A kernel that does not corrupt models, and stays fast.","items":[
      ("done","Solid-safe push/pull: refuse edits that would open a closed solid","f1fd617"),
      ("done","Fixes for caps, loose footprints, offsets, folded neighbours","241a52c"),
      ("done","Spatial grid for edges and vertices, cheaper plane rebuilds, benchmark","39a6203"),
      ("later","Local plane rebuilds (diminishing returns: ~45 ms per op at 9k faces)",""),
      ("done","Import in a Web Worker with progress and Cancel","6991454"),
      ("later","Remaining fuzz leftovers: stray edges, long-sequence orientation","")]},
    {"name":"Presentation sheets","blurb":"Pages you can hand to a client.","items":[
      ("done","Sheets with several drawings, each at its own scale","317c2a9"),
      ("done","Drag drawings, notes and a north arrow; PNG export","b33a983"),
      ("done","Paint bucket, colour fills in plans, elevations, sections","f75f185"),
      ("done","Glass: opacity from materials, see-through in 3D and drawings","b1f4555"),
      ("done","Shading: tint by light, cast shadows with window reveals, ground shadows","2c4cfa2"),
      ("done","3D views on sheets, rendered off-screen (SVG and PDF)","0a7cef1"),
      ("done","Scenes: saved views with an animated fly-to","2202a9a"),
      ("done","Materials with hatch patterns: brick, boards, tiles, concrete, grass","1ab0d26"),
      ("later","Adjustable sun direction and time of day",""),
      ("later","Real textures in the 3D view","")]},
    {"name":"Interoperability","blurb":"Models in and out.","items":[
      ("done","OBJ import: units, axes, colours, drag and drop","ea39fba"),
      ("done","OBJ export with colours and glass","5d977bb"),
      ("done","STL import (binary and ASCII)","93e944c"),
      ("done","glTF / GLB import","93e944c"),
      ("done","DXF import as a 2D underlay for floor plans","1cc6dac"),
      ("later","glTF export, basic IFC","")]},
    {"name":"Precision modelling","blurb":"The focus now: a very nice tool for precise, small designs.","items":[
      ("done","Display units (mm, cm, m, in, ft), decimals, inches and feet when typing","6ef148a"),
      ("done","Snap grid that follows the zoom, or a fixed step down to 0.1 mm","6ef148a"),
      ("done","Camera that frames and zooms into parts a few mm across","6ef148a"),
      ("done","Drawing scales 10:1 to 1:500 with mm scale bars and dimensions","6ef148a"),
      ("done","Follow Me: sweep a face along edges, mitred, fuses or cuts","f0dafa5"),
      ("done","Scale and flip (typed or dragged factors), groups included","31d657a"),
      ("done","Tags for groups and components, with scene visibility","be1873e"),
      ("done","Entity info: length, area, volume, position of the selection; type to edit",""),
      ("later","Fillet and chamfer on edges (built, then removed: not wanted for now)",""),
      ("done","Solid tools in the interface: union, subtract, intersect","fc1650d"),
      ("done","Rounded rectangle (type width;height;radius)","842a9bc"),
      ("next","Polygon and ellipse tools",""),
      ("done","Smooth shading for rounded surfaces","c5f74d6"),
      ("later","Parametric edit: change a dimension and the part follows",""),
      ("later","Component axes and an origin you can set",""),
      ("later","Section planes in 3D (cut away to see inside)","")]},
    {"name":"Making things","blurb":"Taking a precise design out of the screen.","items":[
      ("done","STL export for 3D printing, with a watertight check","bbbcaf0"),
      ("done","Flat parts at true size as SVG or DXF for laser cutting and CNC","98ae709"),
      ("later","Print-size check: wall thickness and minimum features",""),
      ("later","Exploded views and numbered parts",""),]},
    {"name":"Getting started","blurb":"A first screen that shows what the app can do.","items":[
      ("done","Starting model: a modern villa with pool, glazing, terrace, six tags, four scenes, A2 sheet",""),
      ("done","The villa opens by default every time (New gives an empty document); your edits are kept",""),
      ("done","Drawing scale picks itself to fit small or large models",""),
      ("next","Hide the 'Ground floor +0' level markers on small-part drawings",""),
      ("later","Short guided tour over the example",""),
      ("later","Autosave history (go back to an earlier version)","")]},
  ],
  "log":[("Now","Checking the villa in the app: sheet, scenes and drawings."),("Just finished","A sleek villa with a pool as the starting model. Book icon removed."),("Known issue","A subtract leaves open edges when the cutter touches a face exactly tangentially."),("Direction","Precise small-scale modelling first; BIM-style features are parked.")],
}

def render(d):
    label = {"done":"Done","doing":"In progress","next":"Next","later":"Later"}
    total = sum(len(p["items"]) for p in d["phases"])
    done = sum(1 for p in d["phases"] for i in p["items"] if i[0]=="done")
    pct = round(100*done/total)
    stats = "".join(f'<div class="stat"><b>{html.escape(a)}</b><span>{html.escape(b)}</span></div>' for a,b in d["stats"])
    phases = ""
    for p in d["phases"]:
        n=len(p["items"]); k=sum(1 for i in p["items"] if i[0]=="done")
        rows = ""
        for st,text,commit in p["items"]:
            c = f'<code>{commit}</code>' if commit else ''
            rows += f'<li class="{st}"><span class="chip {st}">{label[st]}</span><span class="t">{html.escape(text)}</span>{c}</li>'
        phases += f'<section class="phase"><header><h2>{html.escape(p["name"])}</h2><span class="count">{k}/{n}</span></header><p class="blurb">{html.escape(p["blurb"])}</p><div class="bar"><i style="width:{round(100*k/n)}%"></i></div><ul>{rows}</ul></section>'
    log = "".join(f'<li><span>{html.escape(a)}</span>{html.escape(b)}</li>' for a,b in d["log"])
    return TEMPLATE.replace("%%STATS%%",stats).replace("%%PHASES%%",phases).replace("%%LOG%%",log).replace("%%PCT%%",str(pct)).replace("%%DONE%%",str(done)).replace("%%TOTAL%%",str(total))

TEMPLATE = """<title>Elevation Roadmap</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: a status header, then one column per workstream; items carry a state chip and the commit that finished them. */
:root{
  --bg:#f6f7f8; --surface:#ffffff; --fg:#1b2025; --muted:#66707a; --line:#dde1e5;
  --accent:#2f6fde; --done:#2e8b57; --doing:#c27a12; --next:#2f6fde; --later:#8a939c;
  --done-bg:#e4f3ea; --doing-bg:#fbefd9; --next-bg:#e3ecfb; --later-bg:#eceef0;
  --font:'Instrument Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#13171b; --surface:#1b2026; --fg:#e7eaed; --muted:#98a1ab; --line:#2b323a;
  --accent:#6b9cf0; --done:#5cc48a; --doing:#e3a948; --next:#7ea6f2; --later:#8d97a1;
  --done-bg:#1d3327; --doing-bg:#3a2d14; --next-bg:#1c2b47; --later-bg:#252b32; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#13171b; --surface:#1b2026; --fg:#e7eaed; --muted:#98a1ab; --line:#2b323a;
  --accent:#6b9cf0; --done:#5cc48a; --doing:#e3a948; --next:#7ea6f2; --later:#8d97a1;
  --done-bg:#1d3327; --doing-bg:#3a2d14; --next-bg:#1c2b47; --later-bg:#252b32; color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:14px;line-height:1.5;padding-inline:16px}
.wrap{max-width:1080px;margin:0 auto;padding-block:28px 40px;display:flex;flex-direction:column;gap:24px}
h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
.lead{margin:4px 0 0;color:var(--muted);max-width:62ch}
.top{display:flex;flex-wrap:wrap;gap:20px 32px;align-items:flex-end;justify-content:space-between}
.overall{min-width:220px;flex:0 1 320px}
.overall .num{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;justify-content:space-between}
.overall .bar{height:8px;margin-top:6px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.stat b{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:12px}
.now{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.now h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:500}
.now ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.now li{display:flex;flex-wrap:wrap;gap:4px 12px}
.now li span{width:110px;font-family:var(--mono);font-size:12px;color:var(--accent);flex:none}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:16px}
.phase{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
.phase header{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.phase h2{margin:0;font-size:16px;font-weight:600}
.count{font-family:var(--mono);font-size:12px;color:var(--muted)}
.blurb{margin:0;color:var(--muted)}
.bar{height:4px;background:var(--later-bg);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--done)}
ul{margin:0;padding:0;list-style:none}
.phase ul{display:flex;flex-direction:column;margin-top:4px}
.phase li{display:grid;grid-template-columns:86px 1fr auto;gap:10px;align-items:baseline;padding:7px 0;border-top:1px solid var(--line)}
.phase li.later .t{color:var(--muted)}
.t{min-width:0;text-wrap:pretty}
.chip{font-size:11px;font-weight:500;letter-spacing:.02em;padding:2px 8px;border-radius:999px;text-align:center;white-space:nowrap}
.chip.done{background:var(--done-bg);color:var(--done)} .chip.doing{background:var(--doing-bg);color:var(--doing)}
.chip.next{background:var(--next-bg);color:var(--next)} .chip.later{background:var(--later-bg);color:var(--later)}
code{font-family:var(--mono);font-size:11px;color:var(--muted)}
@media (max-width:460px){.phase li{grid-template-columns:1fr auto}.phase li .chip{grid-column:1;justify-self:start}.phase li .t{grid-column:1}}
</style>
<div class="wrap">
  <div class="top">
    <div><h1>Elevation roadmap</h1><p class="lead">Live-drawing modeller for presentation sheets, running in the browser. Updated as work lands.</p></div>
    <div class="overall"><div class="num"><span>%%DONE%% of %%TOTAL%% planned items done</span><span>%%PCT%%%</span></div><div class="bar"><i style="width:%%PCT%%%"></i></div></div>
  </div>
  <div class="stats">%%STATS%%</div>
  <div class="now"><h3>Activity</h3><ul>%%LOG%%</ul></div>
  <div class="grid">%%PHASES%%</div>
</div>
"""

if __name__=="__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "roadmap.html"
    open(out, "w").write(render(DATA))
    print("written")
