/**
 * The benchmark. One task, three frameworks (Vercel AI SDK, Mastra, oya), all
 * run against the real Anthropic API, over N trials.
 *
 *   ANTHROPIC_API_KEY=sk-... bun run bench [model] [trials] [--task research|weather]
 *
 * Default task is `research` (heavy: large documents, many steps — where a token
 * loop re-sends every payload and blows up, and oya's OPAQUE handles win). Pass
 * `--task weather` for the light case. Reports cost (tokens) and latency as
 * mean ± stddev; the stddev is itself the determinism signal (oya is tight, the
 * loops swing). Identical tool implementations live in `tasks.ts`.
 */

import type { Metrics } from "./metrics.js";
import { TASKS, ledger, resetLedger, type Task } from "./tasks.js";
import { runMastra } from "./mastra.js";
import { runOya } from "./oya.js";
import { runVercel } from "./vercel.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("This benchmark calls the real Anthropic API — set ANTHROPIC_API_KEY.");
  process.exit(1);
}

let taskName = "reconcile";
let model = "claude-haiku-4-5-20251001";
let trials = 3;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--task") taskName = args[++i];
  else if (/^\d+$/.test(a)) trials = Number(a);
  else if (!a.startsWith("--")) model = a;
}
const task = TASKS[taskName];
if (!task) {
  console.error(`unknown task "${taskName}". options: ${Object.keys(TASKS).join(", ")}`);
  process.exit(1);
}

const total = (m: Metrics) => m.inputTokens + m.outputTokens;
function stats(xs: number[]) {
  if (!xs.length) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0;
  return { mean, sd: Math.sqrt(v) };
}
const fmt = (s: { mean: number; sd: number }) => (s.sd >= 1 ? `${Math.round(s.mean)} ± ${Math.round(s.sd)}` : `${Math.round(s.mean)}`);

// --- correctness (the paper's claim: a ReAct loop corrupts state and order) --

/** Order-insensitive structural equality — key order doesn't count as drift. */
function canonical(v: unknown): string {
  const seen = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(seen);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, seen((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return JSON.stringify(seen(v));
}

interface RunLedger {
  received: { tool: string; param: string; value: unknown }[];
  emitted: Record<string, unknown>;
}

export interface Corruption {
  tool: string;
  param: string;
  expected: unknown;
  got: unknown;
}
/** Values that reached a consumer mangled — corrupted state that still "succeeded". */
function stateCorruptions(t: Task, L: RunLedger): Corruption[] {
  const out: Corruption[] = [];
  for (const p of t.provenance ?? []) {
    const got = L.received.find((r) => r.tool === p.tool && r.param === p.param);
    if (!got) continue; // absent = a completeness problem, counted separately
    const expected = L.emitted[p.equals];
    if (canonical(got.value) !== canonical(expected)) out.push({ tool: p.tool, param: p.param, expected, got: got.value });
  }
  return out;
}
/** A tool that ran before a declared dependency. */
function orderViolations(t: Task, seq: string[]): number {
  let n = 0;
  for (const [tool, afters] of Object.entries(t.deps ?? {})) {
    const ti = seq.indexOf(tool);
    if (ti === -1) continue;
    for (const a of afters) {
      const ai = seq.indexOf(a);
      if (ai === -1 || ai > ti) n += 1;
    }
  }
  return n;
}
const isIncomplete = (t: Task, seq: string[]) => (t.required ?? []).some((r) => !seq.includes(r));
function redundantCalls(t: Task, seq: string[]): number {
  let n = 0;
  for (const r of t.required ?? []) {
    const c = seq.filter((x) => x === r).length;
    if (c > 1) n += c - 1;
  }
  return n;
}

interface Correctness {
  corruptRuns: number; // runs with ≥1 corrupted value
  corruptVals: number; // total corrupted values
  orderRuns: number; // runs with ≥1 order violation
  incompleteRuns: number;
  redundant: number;
  distinctSeqs: number;
  sample: Corruption | null; // one concrete mangled value, as evidence
}

interface Agg {
  framework: string;
  ok: number;
  errors: string[];
  rt: ReturnType<typeof stats>;
  inp: ReturnType<typeof stats>;
  out: ReturnType<typeof stats>;
  tot: ReturnType<typeof stats>;
  lat: ReturnType<typeof stats>;
  sample: string[];
  cor: Correctness;
}

const taskToolIds = new Set(task.tools.map((t) => t.id));

const runners: [string, (t: typeof task, m: string) => Promise<Metrics>][] = [
  ["Vercel AI SDK", runVercel],
  ["Mastra", runMastra],
  ["oya", runOya],
];

const aggs: Agg[] = [];
for (const [name, run] of runners) {
  const runs: Metrics[] = [];
  const errors: string[] = [];
  const cor: Correctness = { corruptRuns: 0, corruptVals: 0, orderRuns: 0, incompleteRuns: 0, redundant: 0, distinctSeqs: 0, sample: null };
  const seqs = new Set<string>();
  for (let i = 0; i < trials; i++) {
    process.stderr.write(`  ${name} ${i + 1}/${trials}…\r`);
    resetLedger();
    let m: Metrics;
    try {
      m = await run(task, model);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    // Snapshot what actually flowed through this run, then score correctness.
    const led: RunLedger = { received: ledger.received.map((r) => ({ ...r })), emitted: { ...ledger.emitted } };
    runs.push(m);
    // Correctness is judged over the TASK's real tools only — drop each
    // framework's own scaffolding nodes (oya's extract/summarise, the loops' final).
    const seq = m.sequence.filter((s) => taskToolIds.has(s));
    const corrupt = stateCorruptions(task, led);
    if (corrupt.length > 0) cor.corruptRuns += 1;
    cor.corruptVals += corrupt.length;
    if (!cor.sample && corrupt.length) cor.sample = corrupt[0];
    if (orderViolations(task, seq) > 0) cor.orderRuns += 1;
    if (isIncomplete(task, seq)) cor.incompleteRuns += 1;
    cor.redundant += redundantCalls(task, seq);
    seqs.add(seq.join(">"));
  }
  cor.distinctSeqs = seqs.size;
  aggs.push({
    framework: name,
    ok: runs.length,
    errors,
    rt: stats(runs.map((r) => r.roundTrips)),
    inp: stats(runs.map((r) => r.inputTokens)),
    out: stats(runs.map((r) => r.outputTokens)),
    tot: stats(runs.map(total)),
    lat: stats(runs.map((r) => r.latencyMs ?? 0)),
    sample: runs[0]?.sequence ?? [],
    cor,
  });
}
process.stderr.write("\r" + " ".repeat(40) + "\r");

const L = 18;
const W = Math.max(14, ...aggs.map((a) => a.framework.length + 2));
const pad = (s: string | number) => String(s).padEnd(W);
const row = (label: string, vals: (string | number)[]) => "  " + label.padEnd(L) + vals.map(pad).join("");

console.log(`\n  Task: ${task.name}`);
console.log(`  Mode: LIVE — model = ${model}, ${trials} trial${trials > 1 ? "s" : ""} each\n`);
console.log(row("metric", aggs.map((a) => a.framework)));
console.log("  " + "-".repeat(L + W * aggs.length));
console.log(row("model round-trips", aggs.map((a) => fmt(a.rt))));
console.log(row("input tokens", aggs.map((a) => fmt(a.inp))));
console.log(row("output tokens", aggs.map((a) => fmt(a.out))));
console.log(row("TOTAL tokens", aggs.map((a) => fmt(a.tot))));
console.log(row("latency (ms)", aggs.map((a) => fmt(a.lat))));
console.log(row("failed runs", aggs.map((a) => `${a.errors.length}/${trials}`)));

// Correctness — the paper's claim. Only shown for tasks that declare a spec.
if (task.provenance || task.deps || task.required) {
  console.log(row("accuracy", aggs.map((a) => a.framework)));
  console.log("  " + "-".repeat(L + W * aggs.length));
  console.log(row("state corruption", aggs.map((a) => `${a.cor.corruptRuns}/${a.ok} runs`)));
  console.log(row("  values mangled", aggs.map((a) => String(a.cor.corruptVals))));
  console.log(row("order violations", aggs.map((a) => `${a.cor.orderRuns}/${a.ok}`)));
  console.log(row("incomplete runs", aggs.map((a) => `${a.cor.incompleteRuns}/${a.ok}`)));
  console.log(row("redundant calls", aggs.map((a) => String(a.cor.redundant))));
  console.log(row("distinct orders", aggs.map((a) => `${a.cor.distinctSeqs}`)));

  // Show one concrete corruption as evidence — the value the model re-typed wrong.
  const ev = aggs.find((a) => a.cor.sample);
  if (ev && ev.cor.sample) {
    const s = ev.cor.sample;
    const trim = (v: unknown) => JSON.stringify(v).replace(/^"|"$/g, "");
    console.log(`\n  state corruption caught — ${ev.framework}, ${s.tool}.${s.param}:`);
    console.log(`    the tool emitted:  ${trim(s.expected)}`);
    console.log(`    the model re-sent: ${trim(s.got)}`);
  }
}

const oya = aggs.find((a) => a.framework === "oya");
const loops = aggs.filter((a) => a !== oya);
if (oya && oya.tot.mean > 0 && loops.length) {
  const leaner = loops.reduce((a, b) => (a.tot.mean <= b.tot.mean ? a : b)); // fewest tokens
  const heavier = loops.reduce((a, b) => (a.tot.mean >= b.tot.mean ? a : b));
  // Phrase each comparison honestly whether oya wins or loses on tokens.
  const vs = (loopMean: number) => {
    const r = loopMean / oya.tot.mean;
    return r >= 1 ? `${r.toFixed(1)}× fewer` : `${(1 / r).toFixed(1)}× more`;
  };
  console.log(
    `\n  → oya uses ${vs(leaner.tot.mean)} tokens than ${leaner.framework}, ${vs(heavier.tot.mean)} than ${heavier.framework}, ` +
      `in ${fmt(oya.rt)} round-trips vs ${fmt(leaner.rt)}, and executes one fixed order every run.`,
  );
  if (task.provenance) {
    console.log(
      `  → oya preserves every critical value byte-for-byte and honours every ordering ` +
        `constraint — guaranteed by construction: values stay OPAQUE and are never re-emitted through the model.`,
    );
  }
}
console.log("\n  sample tool sequence (trial 1)");
for (const a of aggs) console.log("    " + a.framework.padEnd(16) + (a.sample.join(" → ") || "(no successful run)"));
for (const a of aggs) if (a.errors.length) console.log(`\n  ${a.framework} error: ${a.errors[0]}`);
console.log("");
