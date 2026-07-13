import { useEffect, useRef, useState } from "react";
import { ArrowUp, Boxes, GitFork } from "lucide-react";
import clsx from "clsx";

import { applyEvent, initialPlanState, type NodeState, type PlanState } from "../src/react/index.js";
import type { OyaEvent } from "../src/stream.js";
import { Dag, type RawPlan } from "./Dag";
import { Markdown } from "./Markdown";

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

const STATUS_STYLE: Record<string, string> = {
  streaming: "text-brand bg-brand/15",
  done: "text-transp bg-transp/15",
  error: "text-danger bg-danger/15",
  idle: "text-faint bg-surface2",
};

export function Studio() {
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
  const status = view?.status ?? "idle";

  return (
    <div className="grid h-screen" style={{ gridTemplateColumns: "244px 1fr 468px" }}>
      <aside className="glass flex min-h-0 flex-col border-r border-line">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <svg width={22} height={22} viewBox="0 0 512 512" aria-hidden className="flex-none">
            <circle cx="276" cy="276" r="160" fill="none" stroke="var(--color-brand)" strokeWidth={80} />
            <circle cx="236" cy="236" r="160" fill="none" stroke="var(--color-fg)" strokeWidth={80} />
          </svg>
          <span className="text-[19px] font-semibold tracking-tight text-fg">
            Oya <span className="font-normal text-muted">Studio</span>
          </span>
        </div>
        <div className="scrollbar-thin flex-1 overflow-auto py-2">
          <div className="mono px-4 pb-1 pt-3 text-[10px] uppercase tracking-[0.18em] text-faint">Agents</div>
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => {
                setAgent(a);
                setSelRun(null);
                setLive(initialPlanState);
              }}
              className={clsx(
                "mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                a === agent ? "bg-brand/15 text-fg ring-1 ring-brand/40" : "text-muted hover:bg-surface2 hover:text-fg",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
              <span className="mono flex-1 text-[12px]">{a}</span>
              {runs.filter((r) => r.agent === a).length > 0 && (
                <span className="mono text-[11px] text-faint">{runs.filter((r) => r.agent === a).length}</span>
              )}
            </button>
          ))}
          <div className="mono px-4 pb-1 pt-5 text-[10px] uppercase tracking-[0.18em] text-faint">Runs</div>
          {runs.length === 0 && <div className="mono px-4 py-1 text-[12px] text-faint">no runs yet</div>}
          {[...runs].reverse().map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelRun(r.id);
                setSel(null);
                setTab("graph");
              }}
              className={clsx(
                "mx-2 flex w-[calc(100%-16px)] flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                selRun === r.id ? "border-line bg-surface2" : "border-transparent hover:bg-surface2",
              )}
            >
              <span className="truncate text-[13px] text-fg">{r.prompt}</span>
              <span className="mono flex gap-3 text-[10px] text-faint">
                <span>{r.agent}</span>
                <span className="inline-flex items-center gap-1">
                  <GitFork size={10} /> {r.nodes.length}
                </span>
                <span>{r.usage ? r.usage.inputTokens + r.usage.outputTokens : 0} tok</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mono border-t border-line px-4 py-3 text-[10px] text-faint">Oya Studio · local</div>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <Boxes size={18} className="text-brand" />
          <span className="text-[17px] font-semibold">{agent || "—"}</span>
          <span className="text-[12px] text-muted">plan-don&apos;t-react agent</span>
        </div>
        <div ref={chatRef} className="scrollbar-thin flex-1 overflow-auto px-6 pb-3 pt-6">
          {msgs.length === 0 ? (
            <div className="mx-auto mt-[14vh] max-w-lg text-center text-muted">
              <h1 className="mb-2 text-[30px] font-semibold text-fg">{agent}</h1>
              <p className="text-[14px] leading-relaxed">
                Ask it something — you&apos;ll see the plan execute on the right, every value disclosed only at its projection level.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {["How's the weather in NYC?", "Summarize a page and make a PDF"].map((t) => (
                  <button
                    key={t}
                    onClick={() => void send(t)}
                    className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:border-brand hover:text-fg"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m, i) => (
              <div key={i} className="mx-auto mb-5 flex max-w-3xl gap-3">
                <div
                  className={clsx(
                    "mono mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md text-[11px] font-bold",
                    m.role === "user" ? "bg-surface2 text-muted" : "bg-brand text-brand-fg",
                  )}
                >
                  {m.role === "user" ? "you" : "◆"}
                </div>
                <div className="min-w-0 flex-1 leading-relaxed">
                  {m.content ? (
                    m.role === "bot" ? (
                      <Markdown text={m.content} />
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )
                  ) : busy && i === msgs.length - 1 ? (
                    <span className="text-faint">…</span>
                  ) : (
                    ""
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-line px-6 pb-5 pt-3.5">
          <div className="mx-auto flex max-w-3xl items-end gap-2.5 rounded-2xl border border-line bg-surface px-4 py-2 focus-within:border-brand/60">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Message the agent…"
              onKeyDown={onKey}
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-fg outline-none placeholder:text-faint"
            />
            <button
              disabled={busy}
              onClick={() => {
                const v = inputRef.current?.value ?? "";
                if (inputRef.current) inputRef.current.value = "";
                void send(v);
              }}
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-brand text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp size={17} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </main>

      <aside className="glass flex min-h-0 flex-col border-l border-line">
        <div className="border-b border-line px-4 pt-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-faint">Run</span>
            <span className={clsx("mono ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[status] ?? STATUS_STYLE.idle)}>
              {status}
            </span>
          </div>
          <div className="flex gap-1">
            {(["graph", "trace", "io"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "mono border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
                  tab === t ? "border-brand text-fg" : "border-transparent text-faint hover:text-muted",
                )}
              >
                {t === "io" ? "I/O" : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {!view || !view.plan ? (
            <div className="p-6 text-center text-[13px] text-faint">Run an agent to see its plan execute here.</div>
          ) : tab === "graph" ? (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <Dag
                  plan={view.plan as RawPlan}
                  nodes={view.nodes}
                  selected={sel}
                  onSelect={(id) => {
                    setSel(id);
                    setTab("io");
                  }}
                />
              </div>
              {view.text && (
                <div className="scrollbar-thin max-h-[38%] overflow-auto border-t border-line p-4 text-[13px] leading-relaxed text-fg">
                  <Markdown text={view.text} />
                </div>
              )}
            </div>
          ) : tab === "trace" ? (
            <div className="scrollbar-thin mono h-full overflow-auto p-4 text-[12px] leading-7">
              {view.events.map((e, i) => (
                <div key={i}>
                  <span className="text-faint">{e.type}</span>
                  {"nodeId" in e ? <b className="text-fg"> {(e as { nodeId: string }).nodeId}</b> : null}
                  {e.type === "text-delta" ? <span className="text-muted">{' "' + e.delta + '"'}</span> : ""}
                </div>
              ))}
            </div>
          ) : (
            <div className="scrollbar-thin h-full overflow-auto p-4">
              {!sel ? (
                <div className="text-center text-[13px] text-faint">Click a node in the Graph to inspect its inputs and outputs.</div>
              ) : (
                <>
                  <div className="mono pb-2 text-[10px] uppercase tracking-[0.18em] text-faint">
                    Node {sel}
                    {selRaw?.skill ? " · " + selRaw.skill : ""}
                  </div>
                  <div className="mono mb-1 mt-2.5 text-[10px] font-semibold text-faint">INPUTS</div>
                  {inputsOf(selRaw).length === 0 && <div className="border-b border-line py-2 text-[12px] italic text-faint">none</div>}
                  {inputsOf(selRaw).map((h) => (
                    <div key={h} className="border-b border-line py-2">
                      <span className="mono text-[12px] font-bold">{h}</span>
                    </div>
                  ))}
                  <div className="mono mb-1 mt-4 text-[10px] font-semibold text-faint">OUTPUTS</div>
                  {!selNode?.handles && <div className="border-b border-line py-2 text-[12px] italic text-faint">— not produced —</div>}
                  {selNode?.handles &&
                    Object.entries(selNode.handles).map(([k, h]) => {
                      const hh = h as { projection?: string; value?: unknown; summary?: unknown };
                      const lvl = hh.projection ?? "OPAQUE";
                      const v =
                        hh.value !== undefined ? JSON.stringify(hh.value, null, 1) : hh.summary !== undefined ? JSON.stringify(hh.summary) : null;
                      return (
                        <div key={k} className="border-b border-line py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`lvl lvl-${lvl}`}>{lvl}</span>
                            <span className="mono text-[12px] font-bold">{k}</span>
                          </div>
                          {v == null ? (
                            <div className="mono mt-1.5 text-[12px] italic text-faint">hidden — OPAQUE, the model never saw this</div>
                          ) : (
                            <div className="mono mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-6 text-muted">{v}</div>
                          )}
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
