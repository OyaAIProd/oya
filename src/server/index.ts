/**
 * Server helpers — `oya/server`.
 *
 * `toSSEResponse` / `toTextResponse` turn an agent's stream into a Fetch
 * `Response` for any server (Next.js route, Bun.serve, edge). `createDevServer`
 * is oya Studio: a local agent console with a chat per agent and a live DAG
 * (trace / replay / projected I/O) on the right.
 */

import type { OyaEvent } from "../stream.js";

/** Server-Sent-Events `Response` carrying every structured event as JSON. */
export function toSSEResponse(stream: AsyncIterable<OyaEvent>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(e) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** A plain `text/plain` streaming `Response` of just the answer deltas. */
export function toTextResponse(textStream: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of textStream) controller.enqueue(encoder.encode(delta));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** Anything with an `agent.stream(prompt).fullStream` (an oya `Agent`). */
export interface StreamableAgent {
  stream(prompt: string): { fullStream: AsyncIterable<OyaEvent> };
}

export interface DevServerOptions {
  /** A single agent (registered as "default") … */
  agent?: StreamableAgent;
  /** … or several, keyed by display name. */
  agents?: Record<string, StreamableAgent>;
  port?: number;
}

/**
 * oya Studio — a local agent console (Bun). `GET /` is the UI; `GET /api/agents`
 * lists registered agents; `POST /api/run` ({ agent, prompt }) streams a run.
 */
export function createDevServer(opts: DevServerOptions) {
  const agents = opts.agents ?? (opts.agent ? { default: opts.agent } : {});
  const names = Object.keys(agents);

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/api/agents") {
      return Response.json(names);
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      const { agent, prompt } = (await req.json()) as { agent?: string; prompt: string };
      const a = (agent && agents[agent]) || agents[names[0]];
      if (!a) return new Response("no agents registered", { status: 404 });
      return toSSEResponse(a.stream(prompt).fullStream);
    }
    return new Response(STUDIO_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  };

  const wanted = opts.port ?? 4000;
  for (let p = wanted; p < wanted + 10; p++) {
    try {
      const server = Bun.serve({ port: p, fetch: handler });
      if (p !== wanted) console.log(`oya: port ${wanted} was busy`);
      console.log(`oya Studio → http://localhost:${p}`);
      return server;
    } catch (e) {
      if (String((e as Error).message).includes("EADDRINUSE")) continue;
      throw e;
    }
  }
  throw new Error(`oya dev server: no free port in ${wanted}..${wanted + 9}`);
}

const STUDIO_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>oya studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --ink:#0a0c11; --panel:#0e1117; --panel2:#11151c; --line:#1b212c; --line2:#252c39;
  --tx:#e9ebf2; --mut:#8a93a6; --faint:#5a6374;
  --coral:#ff6a3d; --coral-dim:#ff6a3d33;
  --opaque:#6b7380; --summary:#f5b740; --transp:#46d6a0;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  background:var(--ink);color:var(--tx);
  font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:14px;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:34px 34px;background-position:-1px -1px;
}
body::before{content:"";position:fixed;inset:0;pointer-events:none;
  background:radial-gradient(120% 80% at 70% -10%, #14202e55, transparent 60%);}
.app{display:grid;grid-template-columns:236px 1fr 440px;height:100vh}
.col{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line);background:rgba(10,12,17,.72);backdrop-filter:blur(6px)}
.col:last-child{border-right:0;border-left:1px solid var(--line)}
.brand{padding:18px 18px 14px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:8px}
.brand .logo{font-family:"Instrument Serif",serif;font-size:30px;line-height:1;letter-spacing:.5px}
.brand .logo b{color:var(--coral);font-style:italic}
.brand .tag{font-size:11px;color:var(--faint);font-style:italic;font-family:"Instrument Serif",serif}
.navsec{padding:14px 12px 4px;font:600 10px/1 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
.item{display:flex;align-items:center;gap:9px;margin:2px 8px;padding:8px 10px;border-radius:9px;cursor:pointer;color:var(--mut);transition:.12s}
.item:hover{background:var(--panel2);color:var(--tx)}
.item.on{background:var(--coral-dim);color:var(--tx);box-shadow:inset 0 0 0 1px #ff6a3d44}
.item .pip{width:7px;height:7px;border-radius:50%;background:var(--coral);box-shadow:0 0 8px var(--coral)}
.item .mono{font-family:"JetBrains Mono",monospace;font-size:12px}
.item .sub{margin-left:auto;font:500 11px "JetBrains Mono",monospace;color:var(--faint)}
.runrow{display:flex;flex-direction:column;gap:2px;margin:2px 8px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent}
.runrow:hover{background:var(--panel2)} .runrow.on{border-color:var(--line2);background:var(--panel2)}
.runrow .t{font-size:13px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.runrow .m{font:500 10px "JetBrains Mono",monospace;color:var(--faint);display:flex;gap:8px}
.spacer{flex:1}
.foot{padding:12px 16px;border-top:1px solid var(--line);font:500 10px "JetBrains Mono",monospace;color:var(--faint)}

/* center chat */
.chead{padding:16px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px}
.chead .nm{font-family:"Instrument Serif",serif;font-size:24px}
.chead .ds{font-size:12px;color:var(--mut)}
.scroll{flex:1;overflow:auto;padding:22px 22px 8px}
.scroll::-webkit-scrollbar{width:9px}.scroll::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px}
.msg{max-width:760px;margin:0 auto 18px;display:flex;gap:12px}
.msg .who{flex:none;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font:700 11px "JetBrains Mono",monospace;margin-top:2px}
.msg.user .who{background:#1b2230;color:var(--mut)} .msg.bot .who{background:var(--coral);color:#1a0a05}
.msg .body{flex:1;line-height:1.6;white-space:pre-wrap}
.msg.bot .body{cursor:pointer}
.msg .runtag{display:inline-flex;align-items:center;gap:6px;margin-top:8px;font:500 10px "JetBrains Mono",monospace;color:var(--faint);border:1px solid var(--line);border-radius:20px;padding:3px 9px}
.empty{max-width:520px;margin:12vh auto;text-align:center;color:var(--mut)}
.empty h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:34px;color:var(--tx);margin:0 0 6px}
.suggest{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px}
.chip{border:1px solid var(--line2);border-radius:20px;padding:7px 13px;cursor:pointer;font-size:13px;color:var(--mut)}
.chip:hover{border-color:var(--coral);color:var(--tx)}
.composer{padding:14px 22px 20px;border-top:1px solid var(--line)}
.box{max-width:760px;margin:0 auto;display:flex;gap:10px;background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:8px 8px 8px 16px;align-items:flex-end}
.box:focus-within{border-color:#ff6a3d66}
textarea{flex:1;background:transparent;border:0;outline:0;color:var(--tx);font:inherit;resize:none;max-height:160px;padding:8px 0}
.send{flex:none;width:38px;height:38px;border:0;border-radius:10px;background:var(--coral);color:#1a0a05;font-size:17px;cursor:pointer;display:grid;place-items:center}
.send:disabled{opacity:.4;cursor:default}

/* right DAG panel */
.rhead{padding:14px 16px 0;border-bottom:1px solid var(--line)}
.rtitle{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.rtitle .t{font:600 10px/1 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
.status{margin-left:auto;font:600 10px "JetBrains Mono",monospace;padding:3px 8px;border-radius:20px}
.status.running{color:var(--coral);background:var(--coral-dim)} .status.done{color:var(--transp);background:#46d6a022} .status.idle{color:var(--faint);background:var(--panel2)} .status.error{color:#ff5d5d;background:#ff5d5d22}
.tabs{display:flex;gap:2px}
.tab{padding:8px 12px;font:600 11px "JetBrains Mono",monospace;color:var(--faint);cursor:pointer;border-bottom:2px solid transparent;letter-spacing:.04em}
.tab:hover{color:var(--mut)} .tab.on{color:var(--tx);border-color:var(--coral)}
.rbody{flex:1;overflow:auto;position:relative}
.rbody::-webkit-scrollbar{width:9px}.rbody::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px}
#dag{display:block;min-width:100%}
.edge{fill:none;stroke:var(--line2);stroke-width:1.5}
.edge.live{stroke:var(--coral);stroke-width:2}
.node rect{fill:var(--panel2);stroke:var(--line2);rx:9;transition:.2s}
.node .id{font:700 12px "JetBrains Mono",monospace;fill:var(--tx)}
.node .kind{font:500 10px "JetBrains Mono",monospace;fill:var(--mut)}
.node.pending rect{opacity:.55}
.node.running rect{stroke:var(--coral);fill:#1a1410;filter:drop-shadow(0 0 10px var(--coral-dim))}
.node.done rect{stroke:var(--transp)}
.node.sel rect{stroke:#fff}
.node{cursor:pointer}
.dot{r:4}.dot.pending{fill:var(--opaque)}.dot.running{fill:var(--coral)}.dot.done{fill:var(--transp)}
.pane{padding:14px 16px}
.log{font:500 12px/1.7 "JetBrains Mono",monospace;white-space:pre-wrap}
.log .e{color:var(--mut)} .log .e b{color:var(--tx)} .log .ts{color:var(--faint)}
.lvl{font:700 9px "JetBrains Mono",monospace;letter-spacing:.06em;padding:2px 6px;border-radius:5px;margin-right:8px;vertical-align:middle}
.lvl.OPAQUE{background:#6b738022;color:var(--opaque)} .lvl.SUMMARY{background:#f5b74022;color:var(--summary)} .lvl.TRANSPARENT{background:#46d6a022;color:var(--transp)}
.hrow{padding:9px 0;border-bottom:1px solid var(--line)}
.hrow .nm{font:700 12px "JetBrains Mono",monospace}
.hrow .v{margin-top:5px;font:500 12px/1.5 "JetBrains Mono",monospace;color:var(--mut);white-space:pre-wrap;word-break:break-word}
.hrow .v.hidden{color:var(--faint);font-style:italic}
.muted{color:var(--faint);padding:18px 0;text-align:center;font-size:13px}
.btn{border:1px solid var(--line2);background:var(--panel2);color:var(--tx);border-radius:8px;padding:7px 12px;font:600 11px "JetBrains Mono",monospace;cursor:pointer}
.btn:hover{border-color:var(--coral)}
.testin{width:100%;min-height:90px;background:var(--panel);border:1px solid var(--line2);border-radius:10px;color:var(--tx);font:500 12px "JetBrains Mono",monospace;padding:10px;resize:vertical}
</style></head>
<body>
<div class="app">
  <!-- sidebar -->
  <aside class="col">
    <div class="brand"><span class="logo"><b>oya</b> studio</span><span class="tag">plan, don't react</span></div>
    <div class="navsec">Agents</div><div id="agents"></div>
    <div class="navsec">Runs</div><div id="runs"></div>
    <div class="spacer"></div>
    <div class="navsec">Views</div>
    <div class="item" id="nav-tests"><span class="mono">Tests</span><span class="sub">batch</span></div>
    <div class="foot" id="foot">localhost</div>
  </aside>
  <!-- chat -->
  <main class="col">
    <div class="chead"><span class="nm" id="agentName">—</span><span class="ds" id="agentDesc"></span></div>
    <div class="scroll" id="chat"></div>
    <div class="composer"><div class="box">
      <textarea id="input" rows="1" placeholder="Message the agent…"></textarea>
      <button class="send" id="send">&#8593;</button>
    </div></div>
  </main>
  <!-- dag -->
  <aside class="col">
    <div class="rhead">
      <div class="rtitle"><span class="t">Run</span><span class="status idle" id="rstatus">idle</span></div>
      <div class="tabs">
        <div class="tab on" data-tab="graph">Graph</div>
        <div class="tab" data-tab="trace">Trace</div>
        <div class="tab" data-tab="replay">Replay</div>
        <div class="tab" data-tab="io">I/O</div>
      </div>
    </div>
    <div class="rbody" id="rbody"></div>
  </aside>
</div>
<script>
"use strict";
var S={agents:[],agent:null,chats:{},runs:[],run:null,tab:"graph",sel:null,busy:false,view:"chat"};
var $=function(s){return document.querySelector(s)};
var el=function(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
var esc=function(s){return String(s).replace(/[&<>]/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[m]})};

/* ---------- init ---------- */
init();
async function init(){
  try{S.agents=await (await fetch("/api/agents")).json()}catch(e){S.agents=[]}
  if(!S.agents.length)S.agents=["default"];
  S.agents.forEach(function(a){S.chats[a]=[]});
  S.agent=S.agents[0];
  $("#foot").textContent=location.host;
  renderAgents();renderRuns();renderChat();renderRight();
  $("#nav-tests").onclick=showTests;
}
function renderAgents(){
  var w=$("#agents");w.innerHTML="";
  S.agents.forEach(function(a){
    var n=S.runs.filter(function(r){return r.agent===a}).length;
    var d=el("div","item"+(S.view==="chat"&&a===S.agent?" on":""));
    d.innerHTML='<span class="pip"></span><span class="mono">'+esc(a)+'</span>'+(n?'<span class="sub">'+n+'</span>':'');
    d.onclick=function(){S.view="chat";S.agent=a;renderAgents();renderChat();renderRight()};
    w.appendChild(d);
  });
}
function renderRuns(){
  var w=$("#runs");w.innerHTML="";
  if(!S.runs.length){w.appendChild(el("div","item",'<span class="mono" style="color:var(--faint)">no runs yet</span>'));return}
  S.runs.slice().reverse().forEach(function(r){
    var d=el("div","runrow"+(S.run===r?" on":""));
    var tok=r.usage?(r.usage.inputTokens+r.usage.outputTokens):0;
    d.innerHTML='<div class="t">'+esc(r.prompt)+'</div><div class="m"><span>'+esc(r.agent)+'</span><span>'+r.nodes.length+' nodes</span>'+(tok?'<span>'+tok+' tok</span>':'')+'</div>';
    d.onclick=function(){openRun(r)};
    w.appendChild(d);
  });
}

/* ---------- chat ---------- */
function renderChat(){
  S.view="chat";
  $("#agentName").textContent=S.agent;
  $("#agentDesc").textContent="plan-don't-react agent";
  var c=$("#chat");c.innerHTML="";
  var msgs=S.chats[S.agent]||[];
  if(!msgs.length){
    var e=el("div","empty");
    e.innerHTML='<h1>'+esc(S.agent)+'</h1><div>Ask it something. You\'ll see the plan execute on the right — every value disclosed only at its projection level.</div>';
    var sg=el("div","suggest");
    ["How's the weather in NYC?","Summarize https://example.com and make a PDF"].forEach(function(t){
      var ch=el("div","chip",esc(t));ch.onclick=function(){$("#input").value=t;send()};sg.appendChild(ch)});
    e.appendChild(sg);c.appendChild(e);return;
  }
  msgs.forEach(function(m){
    var d=el("div","msg "+(m.role==="user"?"user":"bot"));
    var who=m.role==="user"?"you":"oya";
    var rt=m.runId!=null?'<div class="runtag">trace · '+m.nodes+' nodes</div>':'';
    d.innerHTML='<div class="who">'+who+'</div><div class="body">'+esc(m.content||"")+rt+'</div>';
    if(m.runId!=null){var r=S.runs[m.runId];d.querySelector(".body").onclick=function(){openRun(r)}}
    c.appendChild(d);
  });
  c.scrollTop=c.scrollHeight;
}

function send(){
  if(S.busy)return;
  var t=$("#input").value.trim();if(!t)return;
  $("#input").value="";autosize();
  var msgs=S.chats[S.agent];
  msgs.push({role:"user",content:t});
  var bot={role:"bot",content:"",runId:null,nodes:0};msgs.push(bot);
  renderChat();
  var run={id:S.runs.length,agent:S.agent,prompt:t,events:[],nodes:[],edges:[],handles:{},status:"running",usage:null,answer:""};
  S.runs.push(run);S.run=run;bot.runId=run.id;
  S.tab="graph";S.busy=true;$("#send").disabled=true;
  renderRuns();renderRight();
  stream(run,bot);
}

async function stream(run,bot){
  try{
    var res=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:run.agent,prompt:run.prompt})});
    var rd=res.body.getReader(),dec=new TextDecoder(),buf="";
    while(true){
      var r=await rd.read();if(r.done)break;
      buf+=dec.decode(r.value,{stream:true});
      var lines=buf.split("\n");buf=lines.pop();
      for(var i=0;i<lines.length;i++){
        var l=lines[i].trim();if(l.indexOf("data:")!==0)continue;
        var p=l.slice(5).trim();if(!p||p==="[DONE]")continue;
        var e;try{e=JSON.parse(p)}catch(_){continue}
        onEvent(run,bot,e);
      }
    }
  }catch(err){run.status="error";run.error=String(err)}
  if(run.status==="running")run.status="done";
  bot.nodes=run.nodes.length;
  S.busy=false;$("#send").disabled=false;
  renderRuns();renderAgents();if(S.run===run)renderRight();renderChat();
}

function onEvent(run,bot,e){
  run.events.push({t:Date.now(),e:e});
  if(e.type==="text-delta"){run.answer+=e.delta;bot.content=run.answer;renderChatText(bot);return}
  if(e.type==="plan"){buildGraph(run,e.plan)}
  else if(e.type==="node-start"){setNode(run,e.nodeId,"running")}
  else if(e.type==="node-finish"){setNode(run,e.nodeId,"done");run.handles[e.nodeId]=e.handles||{}}
  else if(e.type==="finish"){run.status="done";run.usage=e.usage;
    if(!run.answer){run.answer=e.output!=null?(typeof e.output==="string"?e.output:JSON.stringify(e.output)):("✓ Completed "+run.nodes.length+" steps — the agent produced artifacts but no text reply.");bot.content=run.answer;renderChatText(bot)}}
  else if(e.type==="error"){run.status="error";run.error=e.error}
  if(S.run===run)renderRight();
}
function renderChatText(bot){
  if(S.view!=="chat")return;
  var nodes=document.querySelectorAll(".msg.bot .body");
  if(nodes.length){nodes[nodes.length-1].textContent=bot.content;$("#chat").scrollTop=$("#chat").scrollHeight}
}

/* ---------- graph model ---------- */
function inputsOf(n){var x=n.inputs;if(!x)return[];if(Array.isArray(x))return x.filter(function(h){return typeof h==="string"});return Object.keys(x).map(function(k){return x[k]}).filter(Boolean)}
function buildGraph(run,plan){
  var nodes=(plan.nodes||[]).map(function(n){return{id:n.id,kind:n.kind,skill:n.skill,inputs:inputsOf(n),outputs:(n.outputs||[]).filter(Boolean),state:"pending"}});
  var prod={};nodes.forEach(function(n){n.outputs.forEach(function(o){prod[o]=n.id})});
  var edges=[];nodes.forEach(function(n){n.inputs.forEach(function(h){if(prod[h])edges.push({from:prod[h],to:n.id})})});
  // layers
  var byId={};nodes.forEach(function(n){byId[n.id]=n;n.layer=0});
  for(var pass=0;pass<nodes.length;pass++){edges.forEach(function(ed){byId[ed.to].layer=Math.max(byId[ed.to].layer,byId[ed.from].layer+1)})}
  run.nodes=nodes;run.edges=edges;run.byId=byId;
}
function setNode(run,id,st){var n=run.byId&&run.byId[id];if(n)n.state=st}

/* ---------- right panel ---------- */
function openRun(r){S.run=r;S.view="run";S.tab="graph";S.sel=null;renderRuns();renderRight()}
function renderRight(){
  var st=$("#rstatus"),r=S.run;
  st.className="status "+(r?r.status:"idle");st.textContent=r?r.status:"idle";
  document.querySelectorAll(".tab").forEach(function(t){t.classList.toggle("on",t.dataset.tab===S.tab);t.onclick=function(){S.tab=t.dataset.tab;renderRight()}});
  var b=$("#rbody");b.innerHTML="";
  if(!r){b.appendChild(el("div","muted","Run an agent to see its plan execute here."));return}
  if(S.tab==="graph")b.appendChild(drawDAG(r));
  else if(S.tab==="trace")b.appendChild(drawTrace(r));
  else if(S.tab==="replay")b.appendChild(drawReplay(r));
  else if(S.tab==="io")b.appendChild(drawIO(r));
}

function drawDAG(r){
  if(!r.nodes||!r.nodes.length)return el("div","muted",r.status==="error"?("error: "+esc(r.error||"")):"waiting for the plan…");
  // Vertical layout: each dependency layer is a ROW, flowing top→bottom.
  var NS="http://www.w3.org/2000/svg",NW=166,NH=50,GX=26,GY=48,PAD=24;
  var layers={};r.nodes.forEach(function(n){(layers[n.layer]=layers[n.layer]||[]).push(n)});
  var keys=Object.keys(layers).sort(function(a,b){return a-b});
  var L=keys.length,maxCount=1;keys.forEach(function(k){if(layers[k].length>maxCount)maxCount=layers[k].length});
  var totalW=maxCount*NW+(maxCount-1)*GX,pos={};
  keys.forEach(function(k,row){var arr=layers[k];var rowW=arr.length*NW+(arr.length-1)*GX;var x0=PAD+(totalW-rowW)/2;
    arr.forEach(function(n,i){pos[n.id]={x:x0+i*(NW+GX),y:PAD+row*(NH+GY)}})});
  var W=PAD*2+totalW,H=PAD*2+L*NH+(L-1)*GY;
  var svg=document.createElementNS(NS,"svg");svg.id="dag";svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("width",W);svg.setAttribute("height",H);
  r.edges.forEach(function(ed){
    var a=pos[ed.from],b=pos[ed.to];if(!a||!b)return;
    var x1=a.x+NW/2,y1=a.y+NH,x2=b.x+NW/2,y2=b.y,my=(y1+y2)/2;
    var p=document.createElementNS(NS,"path");
    var live=r.byId[ed.from].state==="done"&&r.byId[ed.to].state!=="pending";
    p.setAttribute("class","edge"+(live?" live":""));
    p.setAttribute("d","M"+x1+","+y1+" C"+x1+","+my+" "+x2+","+my+" "+x2+","+y2);
    svg.appendChild(p);
  });
  r.nodes.forEach(function(n){
    var pp=pos[n.id];var g=document.createElementNS(NS,"g");
    g.setAttribute("class","node "+n.state+(S.sel===n.id?" sel":""));
    g.setAttribute("transform","translate("+pp.x+","+pp.y+")");
    var rect=document.createElementNS(NS,"rect");rect.setAttribute("width",NW);rect.setAttribute("height",NH);rect.setAttribute("rx",10);
    var dot=document.createElementNS(NS,"circle");dot.setAttribute("class","dot "+n.state);dot.setAttribute("cx",16);dot.setAttribute("cy",NH/2);
    var t1=document.createElementNS(NS,"text");t1.setAttribute("class","id");t1.setAttribute("x",32);t1.setAttribute("y",22);t1.textContent=n.id;
    var t2=document.createElementNS(NS,"text");t2.setAttribute("class","kind");t2.setAttribute("x",32);t2.setAttribute("y",38);t2.textContent=(n.skill||n.kind);
    g.appendChild(rect);g.appendChild(dot);g.appendChild(t1);g.appendChild(t2);
    g.onclick=function(){S.sel=n.id;S.tab="io";renderRight()};
    svg.appendChild(g);
  });
  var wrap=el("div","pane");wrap.style.padding="16px";wrap.style.overflowX="auto";wrap.appendChild(svg);
  if(r.answer){var a=el("div","",'<div class="navsec" style="padding:14px 0 6px">Answer</div><div style="line-height:1.6;color:var(--tx);white-space:pre-wrap">'+esc(r.answer)+'</div>');wrap.appendChild(a)}
  return wrap;
}

function drawTrace(r){
  var w=el("div","pane log");var t0=r.events.length?r.events[0].t:0;
  r.events.forEach(function(x){
    var dt=("+"+(x.t-t0)+"ms");var e=x.e;
    var line=el("div","e");
    var label=e.type+(e.nodeId?" <b>"+esc(e.nodeId)+"</b>":"")+(e.skill?" "+esc(e.skill):"")+(e.type==="text-delta"?' "'+esc(e.delta)+'"':"")+(e.type==="finish"?" ok="+e.ok:"");
    line.innerHTML='<span class="ts">'+dt+'</span>  '+label;
    w.appendChild(line);
  });
  if(!r.events.length)w.appendChild(el("div","muted","no events"));
  return w;
}

function drawReplay(r){
  var w=el("div","pane");
  var bar=el("div","",'');bar.style.cssText="display:flex;gap:8px;align-items:center;margin-bottom:14px";
  var btn=el("button","btn","► Replay");var speed=el("span","",'1×');speed.style.cssText="font:500 11px 'JetBrains Mono',monospace;color:var(--faint)";
  bar.appendChild(btn);bar.appendChild(speed);w.appendChild(bar);
  var stage=el("div","");w.appendChild(stage);
  function show(uptoNodes,answer){
    var clone={nodes:r.nodes.map(function(n){return{id:n.id,kind:n.kind,skill:n.skill,inputs:n.inputs,outputs:n.outputs,layer:n.layer,state:uptoNodes[n.id]||"pending"}}),edges:r.edges,byId:{},answer:answer};
    clone.nodes.forEach(function(n){clone.byId[n.id]=n});
    stage.innerHTML="";stage.appendChild(drawDAG(clone));
  }
  show({},"");
  btn.onclick=function(){
    var states={},ans="";var evs=r.events.slice();var i=0;btn.disabled=true;
    (function step(){
      if(i>=evs.length){btn.disabled=false;return}
      var e=evs[i++].e;
      if(e.type==="node-start")states[e.nodeId]="running";
      else if(e.type==="node-finish")states[e.nodeId]="done";
      else if(e.type==="text-delta")ans+=e.delta;
      show(states,ans);
      setTimeout(step, e.type==="text-delta"?40:380);
    })();
  };
  return w;
}

function drawIO(r){
  var w=el("div","pane");
  if(!S.sel){w.appendChild(el("div","muted","Click a node in the Graph to inspect its inputs and outputs."));return w}
  var n=r.byId[S.sel];
  w.appendChild(el("div","navsec",'Node '+esc(n.id)+(n.skill?' · '+esc(n.skill):' · '+esc(n.kind))));
  w.appendChild(el("div","",'<div style="font:600 10px \'JetBrains Mono\';letter-spacing:.14em;color:var(--faint);margin:10px 0 4px">INPUTS</div>'));
  if(!n.inputs.length)w.appendChild(el("div","hrow",'<span class="v hidden">none</span>'));
  n.inputs.forEach(function(h){w.appendChild(el("div","hrow",'<span class="nm">'+esc(h)+'</span>'))});
  w.appendChild(el("div","",'<div style="font:600 10px \'JetBrains Mono\';letter-spacing:.14em;color:var(--faint);margin:16px 0 4px">OUTPUTS</div>'));
  var hs=r.handles[n.id]||{};var keys=Object.keys(hs);
  if(!keys.length)w.appendChild(el("div","hrow",'<span class="v hidden">— not produced —</span>'));
  keys.forEach(function(k){
    var h=hs[k];var lvl=h.projection||"OPAQUE";
    var v=h.value!==undefined?JSON.stringify(h.value,null,1):h.summary!==undefined?JSON.stringify(h.summary):null;
    var vh=v==null?'<span class="v hidden">hidden — OPAQUE, the model never saw this</span>':'<div class="v">'+esc(v)+'</div>';
    w.appendChild(el("div","hrow",'<div><span class="lvl '+lvl+'">'+lvl+'</span><span class="nm">'+esc(k)+'</span></div>'+vh));
  });
  return w;
}

/* ---------- tests view ---------- */
function showTests(){
  S.view="tests";renderAgents();
  $("#agentName").textContent="Tests";$("#agentDesc").textContent="batch-run prompts against "+S.agent;
  var c=$("#chat");c.innerHTML="";
  var wrap=el("div","");wrap.style.cssText="max-width:760px;margin:0 auto";
  wrap.innerHTML='<div class="navsec" style="padding:6px 0 8px">Prompts (one per line)</div>';
  var ta=el("textarea","testin");ta.value="How's the weather in NYC?\nWhat about San Francisco?";wrap.appendChild(ta);
  var row=el("div","");row.style.cssText="margin-top:12px;display:flex;gap:8px;align-items:center";
  var run=el("button","btn","► Run all");var out=el("span","",'');out.style.cssText="font:500 11px 'JetBrains Mono';color:var(--faint)";
  row.appendChild(run);row.appendChild(out);wrap.appendChild(row);
  var res=el("div","");res.style.marginTop="16px";wrap.appendChild(res);
  c.appendChild(wrap);
  run.onclick=async function(){
    var ps=ta.value.split("\n").map(function(s){return s.trim()}).filter(Boolean);
    run.disabled=true;res.innerHTML="";var ok=0;
    for(var i=0;i<ps.length;i++){
      out.textContent="running "+(i+1)+"/"+ps.length;
      var rr=await runHeadless(S.agent,ps[i]);
      if(rr.status==="done")ok++;
      var card=el("div","hrow");
      card.innerHTML='<div><span class="lvl '+(rr.status==="done"?"TRANSPARENT":"OPAQUE")+'">'+(rr.status==="done"?"PASS":"FAIL")+'</span><span class="nm">'+esc(ps[i])+'</span></div><div class="v">'+esc((rr.answer||rr.error||"").slice(0,160))+'</div>';
      card.onclick=(function(rx){return function(){openRun(rx)}})(rr);card.style.cursor="pointer";
      res.appendChild(card);
    }
    out.textContent=ok+"/"+ps.length+" passed";run.disabled=false;renderRuns();
  };
}
async function runHeadless(agent,prompt){
  var run={id:S.runs.length,agent:agent,prompt:prompt,events:[],nodes:[],edges:[],handles:{},status:"running",usage:null,answer:""};
  S.runs.push(run);
  try{
    var res=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({agent:agent,prompt:prompt})});
    var rd=res.body.getReader(),dec=new TextDecoder(),buf="";
    while(true){var r=await rd.read();if(r.done)break;buf+=dec.decode(r.value,{stream:true});
      var lines=buf.split("\n");buf=lines.pop();
      for(var i=0;i<lines.length;i++){var l=lines[i].trim();if(l.indexOf("data:")!==0)continue;var p=l.slice(5).trim();if(!p||p==="[DONE]")continue;var e;try{e=JSON.parse(p)}catch(_){continue}
        run.events.push({t:Date.now(),e:e});
        if(e.type==="plan")buildGraph(run,e.plan);
        else if(e.type==="node-start")setNode(run,e.nodeId,"running");
        else if(e.type==="node-finish"){setNode(run,e.nodeId,"done");run.handles[e.nodeId]=e.handles||{}}
        else if(e.type==="text-delta")run.answer+=e.delta;
        else if(e.type==="finish"){run.status="done";run.usage=e.usage;if(!run.answer&&e.output!=null)run.answer=typeof e.output==="string"?e.output:JSON.stringify(e.output)}
        else if(e.type==="error"){run.status="error";run.error=e.error}
      }}
  }catch(err){run.status="error";run.error=String(err)}
  if(run.status==="running")run.status="done";
  return run;
}

/* ---------- composer ---------- */
var input=$("#input");
function autosize(){input.style.height="auto";input.style.height=Math.min(input.scrollHeight,160)+"px"}
input.addEventListener("input",autosize);
input.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
$("#send").onclick=send;
</script>
</body></html>`;