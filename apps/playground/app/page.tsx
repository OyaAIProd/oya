"use client";

import { useEffect, useRef, useState } from "react";
import { applyEvent, initialPlanState, type NodeState, type PlanState } from "oya/react";
import type { OyaEvent } from "oya";

import { Dag, type RawPlan } from "../components/Dag";

type Msg = { role: "user" | "bot"; content: string };
type Usage = { inputTokens: number; outputTokens: number; modelCalls: number };
type Run = PlanState & { id: number; agent: string; prompt: string; usage?: Usage };

async function* readSSE(res: Response): AsyncGenerator<OyaEvent> {
  const rd = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const p = l.slice(5).trim();
      if (!p || p === "[DONE]") continue;
      try {
        yield JSON.parse(p) as OyaEvent;
      } catch {
        /* keep-alive */
      }
    }
  }
}

const inputsOf = (n: { inputs?: unknown } | undefined): string[] => {
  const x = n?.inputs;
  if (!x) return [];
  if (Array.isArray(x)) return x.filter((h): h is string => typeof h === "string");
  return Object.values(x as Record<string, unknown>).filter((v): v is string => typeof v === "string");
};

export default function Studio() {
  const [agents, setAgents] = useState<string[]>([]);
  const [agent, setAgent] = useState<string>("");
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [live, setLive] = useState<PlanState>(initialPlanState);
  const [selRun, setSelRun] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"graph" | "trace" | "io">("graph");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((a: string[]) => {
        const list = a.length ? a : ["default"];
        setAgents(list);
        setAgent(list[0]);
      })
      .catch(() => {
        setAgents(["default"]);
        setAgent("default");
      });
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  });

  const view: PlanState | null = selRun != null ? runs.find((r) => r.id === selRun) ?? null : live;
  const msgs = chats[agent] ?? [];

  function setBot(a: string, content: string) {
    setChats((c) => {
      const arr = [...(c[a] ?? [])];
      const i = arr.length - 1;
      if (i >= 0 && arr[i].role === "bot") arr[i] = { role: "bot", content };
      return { ...c, [a]: arr };
    });
  }

  async function send(prompt: string) {
    if (busy || !prompt.trim()) return;
    const a = agent;
    setChats((c) => ({ ...c, [a]: [...(c[a] ?? []), { role: "user", content: prompt }, { role: "bot", content: "" }] }));
    setSel(null);
    setSelRun(null);
    setTab("graph");
    setBusy(true);
    let ps: PlanState = { ...initialPlanState, status: "streaming" };
    setLive(ps);
    let outText = "";
    let usage: Usage | undefined;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: a, prompt }),
      });
      for await (const e of readSSE(res)) {
        ps = applyEvent(ps, e);
        setLive(ps);
        if (e.type === "finish") {
          outText = typeof e.output === "string" ? e.output : JSON.stringify(e.output ?? "");
          usage = e.usage;
        }
        if (ps.text) setBot(a, ps.text);
      }
    } catch (err) {
      ps = { ...ps, status: "error", error: String(err) };
      setLive(ps);
    }
    if (ps.status === "streaming") ps = { ...ps, status: "done" };
    setBot(a, ps.text || outText || "✓ done — no text answer");
    setRuns((r) => [...r, { ...ps, id: r.length, agent: a, prompt, usage }]);
    setBusy(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = inputRef.current?.value ?? "";
      if (inputRef.current) inputRef.current.value = "";
      void send(v);
    }
  }

  const selNode: NodeState | undefined = view?.nodes.find((n) => n.nodeId === sel);
  const selRaw = (view?.plan as RawPlan | null)?.nodes?.find((n) => n.id === sel);

  return (
    <div className="app">
      {/* sidebar */}
      <aside className="col">
        <div className="brand">
          <span className="logo">
            <b>oya</b> studio
          </span>
          <span className="tag">plan, don&apos;t react</span>
        </div>
        <div className="navsec">Agents</div>
        {agents.map((a) => (
          <div
            key={a}
            className={"item" + (a === agent ? " on" : "")}
            onClick={() => {
              setAgent(a);
              setSelRun(null);
              setLive(initialPlanState);
            }}
          >
            <span className="pip" />
            <span className="mono">{a}</span>
            {runs.filter((r) => r.agent === a).length > 0 && (
              <span className="sub">{runs.filter((r) => r.agent === a).length}</span>
            )}
          </div>
        ))}
        <div className="navsec">Runs</div>
        {runs.length === 0 && <div className="item"><span className="mono" style={{ color: "var(--faint)" }}>no runs yet</span></div>}
        {[...runs].reverse().map((r) => (
          <div key={r.id} className={"runrow" + (selRun === r.id ? " on" : "")} onClick={() => { setSelRun(r.id); setSel(null); setTab("graph"); }}>
            <div className="t">{r.prompt}</div>
            <div className="m">
              <span>{r.agent}</span>
              <span>{r.nodes.length} nodes</span>
              <span>{r.usage ? r.usage.inputTokens + r.usage.outputTokens : 0} tok</span>
            </div>
          </div>
        ))}
        <div className="spacer" />
        <div className="foot">oya studio · local</div>
      </aside>

      {/* chat */}
      <main className="col">
        <div className="chead">
          <span className="nm">{agent || "—"}</span>
          <span className="ds">plan-don&apos;t-react agent</span>
        </div>
        <div className="scroll" ref={chatRef}>
          {msgs.length === 0 ? (
            <div className="empty">
              <h1>{agent}</h1>
              <div>Ask it something — you&apos;ll see the plan execute on the right, every value disclosed only at its projection level.</div>
              <div className="suggest">
                {["How's the weather in NYC?", "Summarize a page and make a PDF"].map((t) => (
                  <div key={t} className="chip" onClick={() => void send(t)}>{t}</div>
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m, i) => (
              <div key={i} className={"msg " + (m.role === "user" ? "user" : "bot")}>
                <div className="who">{m.role === "user" ? "you" : "oya"}</div>
                <div className="body">{m.content || (busy && i === msgs.length - 1 ? "…" : "")}</div>
              </div>
            ))
          )}
        </div>
        <div className="composer">
          <div className="box">
            <textarea ref={inputRef} rows={1} placeholder="Message the agent…" onKeyDown={onKey} />
            <button className="send" disabled={busy} onClick={() => { const v = inputRef.current?.value ?? ""; if (inputRef.current) inputRef.current.value = ""; void send(v); }}>↑</button>
          </div>
        </div>
      </main>

      {/* dag / trace / io */}
      <aside className="col">
        <div className="rhead">
          <div className="rtitle">
            <span className="t">Run</span>
            <span className={"status " + (view?.status ?? "idle")}>{view?.status ?? "idle"}</span>
          </div>
          <div className="tabs">
            {(["graph", "trace", "io"] as const).map((t) => (
              <div key={t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t === "io" ? "I/O" : t[0].toUpperCase() + t.slice(1)}</div>
            ))}
          </div>
        </div>
        <div className="rbody">
          {!view || !view.plan ? (
            <div className="muted">Run an agent to see its plan execute here.</div>
          ) : tab === "graph" ? (
            <div className="pane">
              <Dag plan={view.plan as RawPlan} nodes={view.nodes} selected={sel} onSelect={(id) => { setSel(id); setTab("io"); }} />
              {view.text && <div className="answer">{view.text}</div>}
            </div>
          ) : tab === "trace" ? (
            <div className="pane log">
              {view.events.map((e, i) => (
                <div key={i}>
                  <span className="ts">{e.type}</span>
                  {"nodeId" in e ? <> <b>{(e as { nodeId: string }).nodeId}</b></> : null}
                  {e.type === "text-delta" ? ' "' + e.delta + '"' : ""}
                </div>
              ))}
            </div>
          ) : (
            <div className="pane">
              {!sel ? (
                <div className="muted">Click a node in the Graph to inspect its inputs and outputs.</div>
              ) : (
                <>
                  <div className="navsec" style={{ padding: "0 0 8px" }}>Node {sel}{selRaw?.skill ? " · " + selRaw.skill : ""}</div>
                  <div style={{ font: "600 10px 'JetBrains Mono'", color: "var(--faint)", margin: "10px 0 4px" }}>INPUTS</div>
                  {inputsOf(selRaw).length === 0 && <div className="hrow"><span className="v hidden">none</span></div>}
                  {inputsOf(selRaw).map((h) => <div key={h} className="hrow"><span className="nm">{h}</span></div>)}
                  <div style={{ font: "600 10px 'JetBrains Mono'", color: "var(--faint)", margin: "16px 0 4px" }}>OUTPUTS</div>
                  {!selNode?.handles && <div className="hrow"><span className="v hidden">— not produced —</span></div>}
                  {selNode?.handles && Object.entries(selNode.handles).map(([k, h]) => {
                    const hh = h as { projection?: string; value?: unknown; summary?: unknown };
                    const lvl = hh.projection ?? "OPAQUE";
                    const v = hh.value !== undefined ? JSON.stringify(hh.value, null, 1) : hh.summary !== undefined ? JSON.stringify(hh.summary) : null;
                    return (
                      <div key={k} className="hrow">
                        <div><span className={"lvl " + lvl}>{lvl}</span><span className="nm">{k}</span></div>
                        {v == null ? <div className="v hidden">hidden — OPAQUE, the model never saw this</div> : <div className="v">{v}</div>}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
