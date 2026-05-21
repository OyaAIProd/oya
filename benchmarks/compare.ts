/**
 * The benchmark. One task, three frameworks (Vercel AI SDK, Mastra, oya), all
 * run against the **real Anthropic API**, over N trials each.
 *
 *   ANTHROPIC_API_KEY=sk-... bun run bench [model-id] [trials]
 *   ANTHROPIC_API_KEY=sk-... bun run bench claude-haiku-4-5-20251001 5
 *
 * It reports cost (tokens), latency, and — because token loops are stochastic —
 * reliability: redundant tool calls, dependency-order violations, incomplete
 * runs, distinct execution sequences, and hard errors. Identical tool
 * implementations live in `task.ts`; the only thing that differs is the
 * architecture.
 */

import type { Metrics } from "./metrics.js";
import { MISSION } from "./task.js";
import { runMastra } from "./weather-mastra.js";
import { runOya } from "./weather-oya.js";
import { runVercel } from "./weather-vercel.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("This benchmark calls the real Anthropic API — set ANTHROPIC_API_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const trials = Number(args.find((a) => /^\d+$/.test(a))) || 3;
const model = args.find((a) => !/^\d+$/.test(a) && !a.startsWith("-")) ?? "claude-haiku-4-5-20251001";

// The three operations the task requires; generate_* both depend on get_weather.
const REQUIRED = ["get_weather", "generate_pdf", "generate_webpage"];

const total = (m: Metrics) => m.inputTokens + m.outputTokens;

function stats(xs: number[]): { mean: number; sd: number } {
  if (xs.length === 0) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0;
  return { mean, sd: Math.sqrt(variance) };
}

function fmt({ mean, sd }: { mean: number; sd: number }): string {
  return sd > 0 ? `${Math.round(mean)} ± ${Math.round(sd)}` : `${Math.round(mean)}`;
}

/** Per-run reliability signals derived from the executed tool sequence. */
function analyze(seq: string[]) {
  const calls = seq.filter((s) => REQUIRED.includes(s));
  const distinct = new Set(calls);
  const firstWeather = calls.indexOf("get_weather");
  const orderViolation = calls.some(
    (c, i) => (c === "generate_pdf" || c === "generate_webpage") && (firstWeather === -1 || i < firstWeather),
  );
  return {
    redundant: calls.length - distinct.size, // repeated tool invocations
    complete: REQUIRED.every((t) => distinct.has(t)),
    orderViolation,
  };
}

interface Agg {
  framework: string;
  ok: number;
  errors: string[];
  rt: { mean: number; sd: number };
  inp: { mean: number; sd: number };
  out: { mean: number; sd: number };
  tot: { mean: number; sd: number };
  lat: { mean: number; sd: number };
  redundantTotal: number;
  orderViolations: number;
  incomplete: number;
  distinctSequences: number;
  sample: string[];
}

function aggregate(framework: string, runs: Metrics[], errors: string[]): Agg {
  const a = runs.map((r) => analyze(r.sequence));
  return {
    framework,
    ok: runs.length,
    errors,
    rt: stats(runs.map((r) => r.roundTrips)),
    inp: stats(runs.map((r) => r.inputTokens)),
    out: stats(runs.map((r) => r.outputTokens)),
    tot: stats(runs.map(total)),
    lat: stats(runs.map((r) => r.latencyMs ?? 0)),
    redundantTotal: a.reduce((s, x) => s + x.redundant, 0),
    orderViolations: a.filter((x) => x.orderViolation).length,
    incomplete: a.filter((x) => !x.complete).length,
    distinctSequences: new Set(runs.map((r) => r.sequence.join(" → "))).size,
    sample: runs[0]?.sequence ?? [],
  };
}

// --- run all trials --------------------------------------------------------

const runners: [string, (m: string) => Promise<Metrics>][] = [
  ["Vercel AI SDK", runVercel],
  ["Mastra", runMastra],
  ["oya", runOya],
];

const aggs: Agg[] = [];
for (const [name, run] of runners) {
  const runs: Metrics[] = [];
  const errors: string[] = [];
  for (let i = 0; i < trials; i++) {
    process.stderr.write(`  running ${name} trial ${i + 1}/${trials}…\r`);
    try {
      runs.push(await run(model));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  aggs.push(aggregate(name, runs, errors));
}
process.stderr.write("\r" + " ".repeat(40) + "\r");

// --- report ----------------------------------------------------------------

const L = 18;
const W = Math.max(14, ...aggs.map((a) => a.framework.length + 2));
const pad = (s: string | number) => String(s).padEnd(W);
const row = (label: string, vals: (string | number)[]) => "  " + label.padEnd(L) + vals.map(pad).join("");

console.log("\n  Task:", MISSION);
console.log(`  Mode: LIVE — model = ${model}, ${trials} trial${trials > 1 ? "s" : ""} each`);
console.log("  (Vercel AI SDK & Mastra are token loops; oya is plan-don't-react)\n");

console.log(row("cost / latency", aggs.map((a) => a.framework)));
console.log("  " + "-".repeat(L + W * aggs.length));
console.log(row("model round-trips", aggs.map((a) => fmt(a.rt))));
console.log(row("input tokens", aggs.map((a) => fmt(a.inp))));
console.log(row("output tokens", aggs.map((a) => fmt(a.out))));
console.log(row("TOTAL tokens", aggs.map((a) => fmt(a.tot))));
console.log(row("latency (ms)", aggs.map((a) => fmt(a.lat))));

console.log("\n" + row(`reliability (/${trials})`, aggs.map((a) => a.framework)));
console.log("  " + "-".repeat(L + W * aggs.length));
console.log(row("redundant calls", aggs.map((a) => a.redundantTotal)));
console.log(row("order violations", aggs.map((a) => `${a.orderViolations}/${trials}`)));
console.log(row("incomplete runs", aggs.map((a) => `${a.incomplete}/${trials}`)));
console.log(row("distinct sequences", aggs.map((a) => `${a.distinctSequences}/${trials}`)));
console.log(row("hard errors", aggs.map((a) => `${a.errors.length}/${trials}`)));

const oya = aggs.find((a) => a.framework === "oya");
const loops = aggs.filter((a) => a !== oya);
if (oya && oya.tot.mean > 0 && loops.length) {
  const bestLoop = Math.min(...loops.map((a) => a.tot.mean));
  console.log(
    `\n  → oya uses ${(100 * (1 - oya.tot.mean / bestLoop)).toFixed(0)}% fewer tokens than the leaner ` +
      `token loop (${(bestLoop / oya.tot.mean).toFixed(2)}×), ${Math.round(oya.rt.mean)} round-trips vs ${Math.round(loops[0].rt.mean)}.`,
  );
}

console.log("\n  sample sequence (trial 1)");
for (const a of aggs) console.log("    " + a.framework.padEnd(16) + (a.sample.join(" → ") || "(no successful run)"));
for (const a of aggs) {
  if (a.errors.length) console.log(`\n  ${a.framework} error: ${a.errors[0]}`);
}
console.log("");
