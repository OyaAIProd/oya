/** The self-contained oya Studio served by `oya dev` (vanilla JS + SVG, one file). */
export const STUDIO_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>oya studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#0a0c11;--panel2:#11151c;--line:#1b212c;--line2:#252c39;--tx:#e9ebf2;--mut:#8a93a6;--faint:#5a6374;--coral:#ff6a3d;--coral-dim:#ff6a3d33;--opaque:#6b7380;--summary:#f5b740;--transp:#46d6a0}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--ink);color:var(--tx);font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:14px;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:34px 34px;background-position:-1px -1px}
.app{display:grid;grid-template-columns:236px 1fr 460px;height:100vh}
.col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line);background:rgba(10,12,17,.72);backdrop-filter:blur(6px)}
.col:last-child{border-right:0;border-left:1px solid var(--line)}
.brand{padding:18px 18px 14px;border-bottom:1px solid var(--line)}
.brand .logo{font-family:"Instrument Serif",serif;font-size:30px;line-height:1}.brand .logo b{color:var(--coral);font-style:italic}
.brand .tag{font-size:11px;color:var(--faint);font-style:italic;font-family:"Instrument Serif",serif;margin-left:8px}
.navsec{padding:14px 12px 4px;font:600 10px/1 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
.item{display:flex;align-items:center;gap:9px;margin:2px 8px;padding:8px 10px;border-radius:9px;cursor:pointer;color:var(--mut)}
.item:hover{background:var(--panel2);color:var(--tx)}.item.on{background:var(--coral-dim);color:var(--tx);box-shadow:inset 0 0 0 1px #ff6a3d44}
.item .pip{width:7px;height:7px;border-radius:50%;background:var(--coral);box-shadow:0 0 8px var(--coral)}
.item .mono{font-family:"JetBrains Mono",monospace;font-size:12px}.item .sub{margin-left:auto;font:500 11px "JetBrains Mono",monospace;color:var(--faint)}
.runrow{margin:2px 8px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent}.runrow:hover,.runrow.on{background:var(--panel2);border-color:var(--line2)}
.runrow .t{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.runrow .m{font:500 10px "JetBrains Mono",monospace;color:var(--faint);display:flex;gap:8px}
.spacer{flex:1}.foot{padding:12px 16px;border-top:1px solid var(--line);font:500 10px "JetBrains Mono",monospace;color:var(--faint)}
.chead{padding:16px 22px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px}.chead .nm{font-family:"Instrument Serif",serif;font-size:24px}.chead .ds{font-size:12px;color:var(--mut)}
.scroll{flex:1;overflow:auto;padding:22px 22px 8px}
.msg{max-width:760px;margin:0 auto 18px;display:flex;gap:12px}.msg .who{flex:none;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font:700 11px "JetBrains Mono",monospace;margin-top:2px}
.msg.user .who{background:#1b2230;color:var(--mut)}.msg.bot .who{background:var(--coral);color:#1a0a05}.msg .body{flex:1;line-height:1.6;white-space:pre-wrap}
.empty{max-width:520px;margin:12vh auto;text-align:center;color:var(--mut)}.empty h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:34px;color:var(--tx);margin:0 0 6px}
.suggest{display:flex;gap:8px;justify-content:center;margin-top:18px;flex-wrap:wrap}.chip{border:1px solid var(--line2);border-radius:20px;padding:7px 13px;cursor:pointer;font-size:13px;color:var(--mut)}.chip:hover{border-color:var(--coral);color:var(--tx)}
.composer{padding:14px 22px 20px;border-top:1px solid var(--line)}.box{max-width:760px;margin:0 auto;display:flex;gap:10px;background:#0e1117;border:1px solid var(--line2);border-radius:14px;padding:8px 8px 8px 16px;align-items:flex-end}.box:focus-within{border-color:#ff6a3d66}
textarea{flex:1;background:transparent;border:0;outline:0;color:var(--tx);font:inherit;resize:none;max-height:160px;padding:8px 0}.send{flex:none;width:38px;height:38px;border:0;border-radius:10px;background:var(--coral);color:#1a0a05;font-size:17px;cursor:pointer}.send:disabled{opacity:.4}
.rhead{padding:14px 16px 0;border-bottom:1px solid var(--line)}.rtitle{display:flex;align-items:center;gap:8px;margin-bottom:10px}.rtitle .t{font:600 10px "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
.status{margin-left:auto;font:600 10px "JetBrains Mono",monospace;padding:3px 8px;border-radius:20px}.status.streaming{color:var(--coral);background:var(--coral-dim)}.status.done{color:var(--transp);background:#46d6a022}.status.idle{color:var(--faint);background:var(--panel2)}.status.error{color:#ff5d5d;background:#ff5d5d22}
.tabs{display:flex;gap:2px}.tab{padding:8px 12px;font:600 11px "JetBrains Mono",monospace;color:var(--faint);cursor:pointer;border-bottom:2px solid transparent}.tab:hover{color:var(--mut)}.tab.on{color:var(--tx);border-bottom-color:var(--coral)}
.rbody{flex:1;overflow:auto}.pane{padding:16px}
svg.dag{display:block}.edge{fill:none;stroke:var(--line2);stroke-width:1.5}.edge.live{stroke:var(--coral);stroke-width:2}
.node rect{fill:var(--panel2);stroke:var(--line2);transition:.2s}.node .id{font:700 12px "JetBrains Mono",monospace;fill:var(--tx)}.node .knd{font:500 10px "JetBrains Mono",monospace;fill:var(--mut)}
.node.pending rect{opacity:.55}.node.running rect{stroke:var(--coral);fill:#1a1410;filter:drop-shadow(0 0 10px var(--coral-dim))}.node.done rect{stroke:var(--transp)}.node.sel rect{stroke:#fff}.node{cursor:pointer}
.ndot.pending{fill:var(--opaque)}.ndot.running{fill:var(--coral)}.ndot.done{fill:var(--transp)}
.log{font:500 12px/1.7 "JetBrains Mono",monospace;white-space:pre-wrap}.log .ts{color:var(--faint)}.log b{color:var(--tx)}
.lvl{font:700 9px "JetBrains Mono",monospace;padding:2px 6px;border-radius:5px;margin-right:8px}.lvl.OPAQUE{background:#6b738022;color:var(--opaque)}.lvl.SUMMARY{background:#f5b74022;color:var(--summary)}.lvl.TRANSPARENT{background:#46d6a022;color:var(--transp)}
.hrow{padding:9px 0;border-bottom:1px solid var(--line)}.hrow .nm{font:700 12px "JetBrains Mono",monospace}.hrow .v{margin-top:5px;font:500 12px/1.5 "JetBrains Mono",monospace;color:var(--mut);white-space:pre-wrap;word-break:break-word}.hrow .v.hidden{color:var(--faint);font-style:italic}
.muted{color:var(--faint);padding:18px;text-align:center}.answer{margin-top:16px;line-height:1.6;color:var(--tx);white-space:pre-wrap}
</style></head><body>
<div class="app">
  <aside class="col">
    <div class="brand"><span class="logo"><b>oya</b> studio</span><span class="tag">plan, don't react</span></div>
    <div class="navsec">Agents</div><div id="agents"></div>
    <div class="navsec">Runs</div><div id="runs"></div>
    <div class="spacer"></div><div class="foot" id="foot">oya dev</div>
  </aside>
  <main class="col">
    <div class="chead"><span class="nm" id="anm">—</span><span class="ds">plan-don't-react agent</span></div>
    <div class="scroll" id="chat"></div>
    <div class="composer"><div class="box"><textarea id="q" rows="1" placeholder="Message the agent…"></textarea><button class="send" id="go">&#8593;</button></div></div>
  </main>
  <aside class="col">
    <div class="rhead"><div class="rtitle"><span class="t">Run</span><span class="status idle" id="st">idle</span></div>
      <div class="tabs"><div class="tab on" data-t="graph">Graph</div><div class="tab" data-t="trace">Trace</div><div class="tab" data-t="io">I/O</div></div></div>
    <div class="rbody" id="rb"></div>
  </aside>
</div>
<script>
"use strict";
var S={agents:[],agent:null,chats:{},runs:[],run:null,tab:"graph",sel:null,busy:false};
var $=function(s){return document.querySelector(s)};
var el=function(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
var esc=function(s){return String(s).replace(/[&<>]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[m]})};
init();
async function init(){
  try{S.agents=await (await fetch("/api/agents")).json()}catch(e){S.agents=[]}
  if(!S.agents.length)S.agents=["default"];
  S.agents.forEach(function(a){S.chats[a]=[]});S.agent=S.agents[0];
  renderAgents();renderRuns();renderChat();renderRight();
  $("#go").onclick=function(){send($("#q").value)};
  $("#q").addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send($("#q").value)}});
  document.querySelectorAll(".tab").forEach(function(t){t.onclick=function(){S.tab=t.dataset.t;renderRight()}});
}
function renderAgents(){var w=$("#agents");w.innerHTML="";S.agents.forEach(function(a){
  var d=el("div","item"+(a===S.agent&&S.run==null?" on":""));
  var n=S.runs.filter(function(r){return r.agent===a}).length;
  d.innerHTML='<span class="pip"></span><span class="mono">'+esc(a)+'</span>'+(n?'<span class="sub">'+n+'</span>':'');
  d.onclick=function(){S.agent=a;S.run=null;renderAgents();renderChat();renderRight()};w.appendChild(d)})}
function renderRuns(){var w=$("#runs");w.innerHTML="";if(!S.runs.length){w.appendChild(el("div","item",'<span class="mono" style="color:var(--faint)">no runs yet</span>'));return}
  S.runs.slice().reverse().forEach(function(r){var d=el("div","runrow"+(S.run===r?" on":""));
  d.innerHTML='<div class="t">'+esc(r.prompt)+'</div><div class="m"><span>'+esc(r.agent)+'</span><span>'+r.nodes.length+' nodes</span></div>';
  d.onclick=function(){S.run=r;S.tab="graph";S.sel=null;renderAgents();renderRuns();renderRight()};w.appendChild(d)})}
function renderChat(){$("#anm").textContent=S.agent;var c=$("#chat");c.innerHTML="";var ms=S.chats[S.agent]||[];
  if(!ms.length){var e=el("div","empty");e.innerHTML='<h1>'+esc(S.agent)+'</h1><div>Ask it something — watch the plan execute on the right, every value disclosed only at its projection level.</div>';
    var sg=el("div","suggest");["How's the weather in NYC?","Summarize a page and make a PDF"].forEach(function(t){var ch=el("div","chip",esc(t));ch.onclick=function(){send(t)};sg.appendChild(ch)});e.appendChild(sg);c.appendChild(e);return}
  ms.forEach(function(m){var d=el("div","msg "+(m.role==="user"?"user":"bot"));d.innerHTML='<div class="who">'+(m.role==="user"?"you":"oya")+'</div><div class="body">'+esc(m.content||"")+'</div>';c.appendChild(d)});c.scrollTop=c.scrollHeight}
function setBot(t){var b=document.querySelectorAll(".msg.bot .body");if(b.length){b[b.length-1].textContent=t;$("#chat").scrollTop=$("#chat").scrollHeight}}
async function send(prompt){prompt=(prompt||"").trim();if(S.busy||!prompt)return;$("#q").value="";var a=S.agent;
  S.chats[a].push({role:"user",content:prompt});var bot={role:"bot",content:""};S.chats[a].push(bot);renderChat();
  var run={agent:a,prompt:prompt,events:[],nodes:[],edges:[],byId:{},handles:{},status:"streaming",answer:""};
  S.runs.push(run);S.run=run;S.sel=null;S.tab="graph";S.busy=true;$("#go").disabled=true;renderRuns();renderRight();
  try{var res=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:a,prompt:prompt})});
    var rd=res.body.getReader(),dec=new TextDecoder(),buf="";
    while(true){var r=await rd.read();if(r.done)break;buf+=dec.decode(r.value,{stream:true});var lines=buf.split("\n");buf=lines.pop();
      for(var i=0;i<lines.length;i++){var l=lines[i].trim();if(l.indexOf("data:")!==0)continue;var p=l.slice(5).trim();if(!p||p==="[DONE]")continue;var e;try{e=JSON.parse(p)}catch(_){continue}onEvent(run,bot,e)}}
  }catch(err){run.status="error";run.error=String(err)}
  if(run.status==="streaming")run.status="done";if(!bot.content)setBot(bot.content=run.answer||"✓ done");
  S.busy=false;$("#go").disabled=false;renderAgents();renderRuns();renderRight()}
function onEvent(run,bot,e){run.events.push({t:Date.now(),e:e});
  if(e.type==="text-delta"){run.answer+=e.delta;bot.content=run.answer;setBot(run.answer);return}
  if(e.type==="plan"){buildGraph(run,e.plan)}
  else if(e.type==="node-start"){var n=run.byId[e.nodeId];if(n)n.state="running"}
  else if(e.type==="node-finish"){var n2=run.byId[e.nodeId];if(n2)n2.state="done";run.handles[e.nodeId]=e.handles||{}}
  else if(e.type==="finish"){run.status="done";if(e.output!=null&&!run.answer){run.answer=typeof e.output==="string"?e.output:JSON.stringify(e.output);bot.content=run.answer;setBot(run.answer)}}
  else if(e.type==="error"){run.status="error";run.error=e.error}
  if(S.run===run)renderRight()}
function inputsOf(n){var x=n.inputs;if(!x)return[];if(Array.isArray(x))return x.filter(function(h){return typeof h==="string"});return Object.keys(x).map(function(k){return x[k]}).filter(Boolean)}
function buildGraph(run,plan){var nodes=(plan.nodes||[]).map(function(n){return{id:n.id,kind:n.kind,skill:n.skill,inputs:inputsOf(n),outputs:(n.outputs||[]).filter(Boolean),state:"pending"}});
  var prod={};nodes.forEach(function(n){n.outputs.forEach(function(o){prod[o]=n.id})});
  var edges=[];nodes.forEach(function(n){n.inputs.forEach(function(h){if(prod[h])edges.push({from:prod[h],to:n.id})})});
  var byId={};nodes.forEach(function(n){byId[n.id]=n;n.layer=0});
  for(var p=0;p<nodes.length;p++)edges.forEach(function(ed){byId[ed.to].layer=Math.max(byId[ed.to].layer,byId[ed.from].layer+1)});
  run.nodes=nodes;run.edges=edges;run.byId=byId}
function renderRight(){var r=S.run,st=$("#st");st.className="status "+(r?r.status:"idle");st.textContent=r?r.status:"idle";
  document.querySelectorAll(".tab").forEach(function(t){t.classList.toggle("on",t.dataset.t===S.tab)});
  var b=$("#rb");b.innerHTML="";if(!r||!r.nodes.length){b.appendChild(el("div","muted","Run an agent to see its plan execute here."));return}
  if(S.tab==="graph")b.appendChild(drawDAG(r));else if(S.tab==="trace")b.appendChild(drawTrace(r));else b.appendChild(drawIO(r))}
function drawDAG(r){var NS="http://www.w3.org/2000/svg",NW=166,NH=50,GX=26,GY=48,PAD=24;
  var layers={};r.nodes.forEach(function(n){(layers[n.layer]=layers[n.layer]||[]).push(n)});
  var keys=Object.keys(layers).sort(function(a,b){return a-b}),L=keys.length,maxC=1;keys.forEach(function(k){if(layers[k].length>maxC)maxC=layers[k].length});
  var totalW=maxC*NW+(maxC-1)*GX,pos={};
  keys.forEach(function(k,row){var arr=layers[k],rowW=arr.length*NW+(arr.length-1)*GX,x0=PAD+(totalW-rowW)/2;arr.forEach(function(n,i){pos[n.id]={x:x0+i*(NW+GX),y:PAD+row*(NH+GY)}})});
  var W=PAD*2+totalW,H=PAD*2+L*NH+(L-1)*GY,svg=document.createElementNS(NS,"svg");svg.setAttribute("class","dag");svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("width",W);svg.setAttribute("height",H);
  r.edges.forEach(function(ed){var a=pos[ed.from],b=pos[ed.to];if(!a||!b)return;var x1=a.x+NW/2,y1=a.y+NH,x2=b.x+NW/2,y2=b.y,my=(y1+y2)/2;
    var pth=document.createElementNS(NS,"path"),live=r.byId[ed.from].state==="done"&&r.byId[ed.to].state!=="pending";pth.setAttribute("class","edge"+(live?" live":""));pth.setAttribute("d","M"+x1+","+y1+" C"+x1+","+my+" "+x2+","+my+" "+x2+","+y2);svg.appendChild(pth)});
  r.nodes.forEach(function(n){var pp=pos[n.id],g=document.createElementNS(NS,"g");g.setAttribute("class","node "+n.state+(S.sel===n.id?" sel":""));g.setAttribute("transform","translate("+pp.x+","+pp.y+")");
    var rect=document.createElementNS(NS,"rect");rect.setAttribute("width",NW);rect.setAttribute("height",NH);rect.setAttribute("rx",10);
    var dot=document.createElementNS(NS,"circle");dot.setAttribute("class","ndot "+n.state);dot.setAttribute("cx",16);dot.setAttribute("cy",NH/2);dot.setAttribute("r",4);
    var t1=document.createElementNS(NS,"text");t1.setAttribute("class","id");t1.setAttribute("x",32);t1.setAttribute("y",22);t1.textContent=n.id;
    var t2=document.createElementNS(NS,"text");t2.setAttribute("class","knd");t2.setAttribute("x",32);t2.setAttribute("y",38);t2.textContent=n.skill||n.kind;
    g.appendChild(rect);g.appendChild(dot);g.appendChild(t1);g.appendChild(t2);g.onclick=function(){S.sel=n.id;S.tab="io";renderRight()};svg.appendChild(g)});
  var wrap=el("div","pane");wrap.appendChild(svg);if(r.answer)wrap.appendChild(el("div","",'<div class="navsec" style="padding:14px 0 6px">Answer</div><div class="answer">'+esc(r.answer)+'</div>'));return wrap}
function drawTrace(r){var w=el("div","pane log"),t0=r.events.length?r.events[0].t:0;
  r.events.forEach(function(x){var e=x.e,d=el("div");d.innerHTML='<span class="ts">+'+(x.t-t0)+'ms</span>  '+e.type+(e.nodeId?' <b>'+esc(e.nodeId)+'</b>':'')+(e.type==="text-delta"?' "'+esc(e.delta)+'"':'');w.appendChild(d)});return w}
function drawIO(r){var w=el("div","pane");if(!S.sel){w.appendChild(el("div","muted","Click a node in the Graph to inspect its inputs and outputs."));return w}
  var n=r.byId[S.sel];w.appendChild(el("div","navsec",'Node '+esc(n.id)+(n.skill?' · '+esc(n.skill):' · '+esc(n.kind))));
  w.appendChild(el("div","",'<div style="font:600 10px \'JetBrains Mono\';color:var(--faint);margin:10px 0 4px">INPUTS</div>'));
  if(!n.inputs.length)w.appendChild(el("div","hrow",'<span class="v hidden">none</span>'));
  n.inputs.forEach(function(h){w.appendChild(el("div","hrow",'<span class="nm">'+esc(h)+'</span>'))});
  w.appendChild(el("div","",'<div style="font:600 10px \'JetBrains Mono\';color:var(--faint);margin:16px 0 4px">OUTPUTS</div>'));
  var hs=r.handles[n.id]||{},keys=Object.keys(hs);if(!keys.length)w.appendChild(el("div","hrow",'<span class="v hidden">— not produced —</span>'));
  keys.forEach(function(k){var h=hs[k],lvl=h.projection||"OPAQUE",v=h.value!==undefined?JSON.stringify(h.value,null,1):h.summary!==undefined?JSON.stringify(h.summary):null;
    w.appendChild(el("div","hrow",'<div><span class="lvl '+lvl+'">'+lvl+'</span><span class="nm">'+esc(k)+'</span></div>'+(v==null?'<div class="v hidden">hidden — OPAQUE, the model never saw this</div>':'<div class="v">'+esc(v)+'</div>')))});return w}
</script></body></html>`;
