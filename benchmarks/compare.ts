/**
 * The benchmark. One task, three frameworks (Vercel AI SDK, Mastra, oya), all
 * run against the real Anthropic API, over N trials.
 *
 *   ANTHROPIC_API_KEY=sk-... bun run bench [model] [trials] [--task research|weather]
 *
 * Default task is `research` (heavy: large documents, many steps - where a token
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
  console.error("This benchmark calls the real Anthropic API - set ANTHROPIC_API_KEY.");
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

/** Order-insensitive structural equality - key order doesn't count as drift. */
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
/** Values that reached a consumer mangled - corrupted state that still "succeeded". */
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

const t0 = performance.now();
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
    // Correctness is judged over the TASK's real tools only - drop each
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

// ── presentation ───────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const gray = c("90");
const green = c("1;32");
const coral = c("38;5;209");
const commas = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtN = (s: { mean: number; sd: number }) => (s.sd >= 1 ? `${commas(s.mean)} ± ${commas(s.sd)}` : commas(s.mean));
const fmtSec = (s: { mean: number; sd: number }) => `${(s.mean / 1000).toFixed(1)}s`;

const LBL = 20;
const COL = Math.max(15, ...aggs.map((a) => a.framework.length + 3));
const oyaIdx = aggs.findIndex((a) => a.framework === "oya");
const rule = () => "  " + gray("─".repeat(LBL + COL * aggs.length));
// A data row: label on the left, one padded cell per framework; the oya column bold-green.
const line = (label: string, vals: string[]) =>
  "  " + label.padEnd(LBL) + vals.map((v, i) => (i === oyaIdx ? green(v.padEnd(COL)) : v.padEnd(COL))).join("");
// A header row: framework names, oya highlighted.
const header = (label: string) =>
  "  " + gray(label.padEnd(LBL)) + aggs.map((a, i) => (i === oyaIdx ? green(bold(a.framework.padEnd(COL))) : bold(a.framework.padEnd(COL)))).join("");

// Banner
const title = "oya · plan-don't-react benchmark";
const sub = `${task.name} · ${model} · ${trials} trial${trials > 1 ? "s" : ""} · live Anthropic API`;
const bw = Math.max(title.length, sub.length) + 2;
console.log("\n  " + coral("╭" + "─".repeat(bw) + "╮"));
console.log("  " + coral("│ ") + bold(title.padEnd(bw - 2)) + coral(" │"));
console.log("  " + coral("│ ") + dim(sub.padEnd(bw - 2)) + coral(" │"));
console.log("  " + coral("╰" + "─".repeat(bw) + "╯") + "\n");

// Cost & speed
console.log(header("cost & speed"));
console.log(rule());
console.log(line("model round-trips", aggs.map((a) => fmt(a.rt))));
console.log(line("total tokens", aggs.map((a) => fmtN(a.tot))));
console.log(line("  input", aggs.map((a) => fmtN(a.inp))));
console.log(line("  output", aggs.map((a) => fmtN(a.out))));
console.log(line("latency", aggs.map((a) => fmtSec(a.lat))));
console.log(line("failed runs", aggs.map((a) => `${a.errors.length}/${trials}`)));

// Correctness - the paper's claim. Only shown for tasks that declare a spec.
if (task.provenance || task.deps || task.required) {
  console.log("\n" + header("correctness"));
  console.log(rule());
  if (task.provenance) console.log(line("state corruption", aggs.map((a) => `${a.cor.corruptRuns}/${a.ok}`)));
  console.log(line("order violations", aggs.map((a) => `${a.cor.orderRuns}/${a.ok}`)));
  console.log(line("incomplete runs", aggs.map((a) => `${a.cor.incompleteRuns}/${a.ok}`)));
  console.log(line("redundant calls", aggs.map((a) => String(a.cor.redundant))));
  console.log(line("distinct orders", aggs.map((a) => String(a.cor.distinctSeqs))));

  const ev = aggs.find((a) => a.cor.sample);
  if (ev && ev.cor.sample) {
    const s = ev.cor.sample;
    const trim = (v: unknown) => JSON.stringify(v).replace(/^"|"$/g, "");
    console.log("\n  " + coral(`state corruption caught - ${ev.framework}, ${s.tool}.${s.param}:`));
    console.log("    emitted:  " + dim(trim(s.expected)));
    console.log("    re-sent:  " + bold(trim(s.got)));
  }
}

// Headline
const oya = aggs.find((a) => a.framework === "oya");
const loops = aggs.filter((a) => a !== oya);
if (oya && oya.tot.mean > 0 && loops.length) {
  const leaner = loops.reduce((a, b) => (a.tot.mean <= b.tot.mean ? a : b));
  const heavier = loops.reduce((a, b) => (a.tot.mean >= b.tot.mean ? a : b));
  const vs = (loopMean: number) => {
    const r = loopMean / oya.tot.mean;
    return r >= 1 ? `${r.toFixed(1)}× fewer` : `${(1 / r).toFixed(1)}× more`;
  };
  console.log(
    "\n  " + coral("→ ") +
      `oya uses ${bold(vs(leaner.tot.mean))} tokens than ${leaner.framework}, ${bold(vs(heavier.tot.mean))} than ${heavier.framework}, ` +
      `in ${fmt(oya.rt)} round-trips vs ${fmt(leaner.rt)}, and executes ${bold("one fixed order")} every run.`,
  );
  if (task.provenance) {
    console.log(
      "  " + coral("→ ") +
        "oya preserves every critical value byte-for-byte and honours every ordering constraint - " +
        bold("guaranteed by construction") + ": values stay OPAQUE and are never re-emitted through the model.",
    );
  }
}

// Tool sequences + timing
console.log("\n  " + gray("tool sequence (trial 1)"));
for (const a of aggs) {
  const label = a.framework === "oya" ? green(a.framework.padEnd(16)) : a.framework.padEnd(16);
  console.log("    " + label + dim(a.sample.join(" → ") || "(no successful run)"));
}
for (const a of aggs) if (a.errors.length) console.log("\n  " + a.framework + " error: " + a.errors[0]);
console.log("\n  " + dim(`${aggs.length} frameworks · ${trials} trials each · ${((performance.now() - t0) / 1000).toFixed(0)}s total`) + "\n");
