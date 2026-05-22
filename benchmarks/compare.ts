/**
 * The benchmark. One task, three frameworks (Vercel AI SDK, Mastra, oya), all
 * run against the real Anthropic API, over N trials.
 *
 *   ANTHROPIC_API_KEY=sk-... bun run bench [model] [trials] [--task research|weather]
 *
 * Default task is `research` (heavy: large documents, many steps — where token
 * loops blow up). Reports cost (tokens) and latency as mean ± stddev; the stddev
 * is itself the determinism signal (oya is tight, the loops swing). Identical tool
 * implementations live in `tasks.ts`.
 */

import type { Metrics } from "./metrics.js";
import { TASKS } from "./tasks.js";
import { runMastra } from "./mastra.js";
import { runOya } from "./oya.js";
import { runVercel } from "./vercel.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("This benchmark calls the real Anthropic API — set ANTHROPIC_API_KEY.");
  process.exit(1);
}

let taskName = "research";
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
}

const runners: [string, (t: typeof task, m: string) => Promise<Metrics>][] = [
  ["Vercel AI SDK", runVercel],
  ["Mastra", runMastra],
  ["oya", runOya],
];

const aggs: Agg[] = [];
for (const [name, run] of runners) {
  const runs: Metrics[] = [];
  const errors: string[] = [];
  for (let i = 0; i < trials; i++) {
    process.stderr.write(`  ${name} ${i + 1}/${trials}…\r`);
    try {
      runs.push(await run(task, model));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
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

const oya = aggs.find((a) => a.framework === "oya");
const loops = aggs.filter((a) => a !== oya);
if (oya && oya.tot.mean > 0 && loops.length) {
  const best = Math.min(...loops.map((a) => a.tot.mean));
  const worst = Math.max(...loops.map((a) => a.tot.mean));
  console.log(
    `\n  → oya uses ${(best / oya.tot.mean).toFixed(1)}× fewer tokens than the leaner token loop, ` +
      `${(worst / oya.tot.mean).toFixed(1)}× fewer than the heavier one — and its cost barely varies ` +
      `(±${Math.round(oya.tot.sd)} vs ±${Math.round(Math.max(...loops.map((a) => a.tot.sd)))}).`,
  );
}
console.log("\n  sample tool sequence (trial 1)");
for (const a of aggs) console.log("    " + a.framework.padEnd(16) + (a.sample.join(" → ") || "(no successful run)"));
for (const a of aggs) if (a.errors.length) console.log(`\n  ${a.framework} error: ${a.errors[0]}`);
console.log("");
