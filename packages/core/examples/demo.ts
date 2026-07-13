/**
 * A paced terminal demo of a plan-don't-react run — for a screen/GIF capture.
 * Canned local model, no API key, deterministic.
 *
 *   make demo      (or: bun examples/demo.ts)
 */

import { Agent, createTool, type LanguageModel } from "../src/index.js";
import { z } from "zod";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  gray: "\x1b[90m", green: "\x1b[32m", amber: "\x1b[33m", coral: "\x1b[38;5;209m",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out = (s: string) => process.stdout.write(s);
const MISSION = "How's the weather in NYC? Then generate a PDF and a web page.";

const tools = {
  get_weather: createTool({ id: "get_weather", description: "Look up the weather", inputSchema: z.object({ city: z.string() }), execute: async ({ city }) => ({ city, tempF: 72, condition: "sunny", humidity: 41 }) }),
  generate_pdf: createTool({ id: "generate_pdf", description: "Render a PDF", inputSchema: z.object({ report: z.any() }), execute: async ({ report }) => ({ path: "/tmp/nyc.pdf", bytes: JSON.stringify(report).length }) }),
  generate_webpage: createTool({ id: "generate_webpage", description: "Render a web page", inputSchema: z.object({ report: z.any() }), execute: async () => ({ url: "/nyc.html" }) }),
};

const ANSWER = "It's 72°F and sunny in New York City (41% humidity). Your PDF and web page are ready.";
const PLAN = {
  plan_id: "weather",
  handles: [
    { name: "weather", type: "WeatherReport", projection: "OPAQUE", origin: "n0" },
    { name: "pdf", type: "PdfFile", projection: "OPAQUE", origin: "n1" },
    { name: "page", type: "WebPage", projection: "OPAQUE", origin: "n2" },
    { name: "answer", type: "str", projection: "TRANSPARENT", origin: "n3" },
  ],
  nodes: [
    { id: "n0", kind: "skill", skill: "get_weather@1", args: { city: "NYC" }, outputs: ["weather"] },
    { id: "n1", kind: "skill", skill: "generate_pdf@1", inputs: { report: "weather" }, outputs: ["pdf"] },
    { id: "n2", kind: "skill", skill: "generate_webpage@1", inputs: { report: "weather" }, outputs: ["page"] },
    { id: "n3", kind: "summarise", inputs: ["weather"], outputs: ["answer"] },
  ],
  exits: ["answer", "pdf", "page"],
};
const model: LanguageModel = {
  provider: "local", modelId: "demo",
  async complete() { return JSON.stringify(PLAN); },
  async *stream() { for (const w of ANSWER.split(" ")) yield { textDelta: w + " " }; },
};

const labelOf = (id: string) => {
  const n = PLAN.nodes.find((x) => x.id === id)!;
  return (n.skill ? n.skill.split("@")[0] : n.kind).padEnd(18);
};

out(`\n  ${C.bold}Oya${C.reset} ${C.dim}— plan, don't react${C.reset}\n\n`);
out(`  ${C.dim}❯${C.reset} ${MISSION}\n\n`);
await sleep(700);

let answer = "";
for await (const e of new Agent({ name: "WeatherBot", model, tools }).stream(MISSION).fullStream) {
  if (e.type === "plan") {
    out(`  ${C.coral}▸${C.reset} plan · ${e.plan.nodes.length} nodes\n\n`);
    await sleep(450);
  } else if (e.type === "node-finish") {
    const h = Object.values(e.handles)[0] as { projection?: string } | undefined;
    const lvl = h?.projection ?? "—";
    const tag =
      lvl === "OPAQUE" ? `${C.gray}OPAQUE · hidden from the model${C.reset}`
      : lvl === "TRANSPARENT" ? `${C.green}TRANSPARENT${C.reset}`
      : lvl === "SUMMARY" ? `${C.amber}SUMMARY${C.reset}` : "";
    out(`  ${C.green}●${C.reset} ${labelOf(e.nodeId)} ${tag}\n`);
    await sleep(420);
  } else if (e.type === "text-delta") {
    answer += e.delta;
  }
}

out(`\n  ${C.coral}❯${C.reset} `);
for (const ch of answer) { out(ch); await sleep(18); }
out(`\n\n  ${C.gray}the PDF and the web page stayed OPAQUE — the model never read them.${C.reset}\n\n`);
