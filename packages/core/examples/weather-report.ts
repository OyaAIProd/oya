/**
 * "How's the weather in NYC? Then generate a PDF and a web page."
 *
 * Mastra-shaped API (`createTool` + `Agent.generate`), three tools, one mission.
 * The model answers the weather question (it needs the weather, so that value is
 * disclosed), but the generated PDF and HTML page stay OPAQUE - handed to the
 * user as artifacts, never fed back through the model. In a token loop those whole
 * documents would be re-read into the context.
 *
 *   pnpm example
 */

import { Agent, createTool, type LanguageModel } from "../src/index.js";
import { z } from "zod";

// --- three tools (Mastra-style createTool) ---------------------------------

const getWeather = createTool({
  id: "get_weather",
  description: "Look up the current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({
    city,
    tempF: 72,
    condition: "sunny",
    humidity: 41,
    station: "KNYC",
    raw: "…full forecast payload…",
  }),
});

const generatePdf = createTool({
  id: "generate_pdf",
  description: "Render a report object into a PDF file",
  inputSchema: z.object({ report: z.any() }),
  execute: async ({ report }) => ({ path: "/tmp/nyc-weather.pdf", bytes: JSON.stringify(report).length }),
});

const generateWebpage = createTool({
  id: "generate_webpage",
  description: "Render a report object into an HTML page",
  inputSchema: z.object({ report: z.any() }),
  execute: async ({ report }) => ({
    url: "/nyc-weather.html",
    html: `<h1>NYC weather</h1><pre>${JSON.stringify(report)}</pre>`,
  }),
});

// --- the agent -------------------------------------------------------------
//
// In production this is just:  model: anthropic("claude-haiku-4-5-20251001")
// Here we use a canned local model so the example runs with no API key.
const localModel: LanguageModel = {
  provider: "local",
  modelId: "canned",
  async complete({ system }) {
    if (system.includes("executing a single")) {
      return JSON.stringify({ answer: "It's 72°F and sunny in New York City (41% humidity)." });
    }
    return JSON.stringify(cannedPlan());
  },
};

const agent = new Agent({
  name: "WeatherBot",
  instructions: "You are a helpful weather assistant. Use the tools, then reply concisely.",
  model: localModel,
  tools: { get_weather: getWeather, generate_pdf: generatePdf, generate_webpage: generateWebpage },
});

const res = await agent.generate("How's the weather in NYC? Then generate a PDF and a web page.");

// --- what happened --------------------------------------------------------

console.log("Answer (what the user sees):\n   ", res.text, "\n");

console.log("Artifacts generated server-side:");
console.log("    PDF :", (res.outputs.pdf as { path: string; bytes: number }).path,
  `(${(res.outputs.pdf as { bytes: number }).bytes} bytes)`);
console.log("    Page:", (res.outputs.page as { url: string }).url, "\n");

console.log("What the model was allowed to see:");
const view = res.result.execution!.view(res.result.plan!);
for (const [name, h] of Object.entries(view)) {
  const disclosed = "value" in h ? "full value" : "summary" in h ? "summary only" : "nothing";
  console.log(`    ${name.padEnd(8)} ${String(h.projection).padEnd(12)} → ${disclosed}`);
}
console.log("\n→ The PDF bytes and the HTML page stayed OPAQUE - never re-read by the model.");

// The plan the model emits (it never appears in your code; shown here for the
// demo). A function declaration so it's available to the model closure above.
function cannedPlan() {
  return {
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
}
