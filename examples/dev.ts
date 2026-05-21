/**
 * oya Studio — local agent console.
 *
 *   make dev      (or: bun examples/dev.ts)  →  http://localhost:4000
 *
 * Registers two agents. Uses the Anthropic provider when ANTHROPIC_API_KEY is
 * set; otherwise a canned local model per agent, so it runs with no key.
 */

import { Agent, createTool, type LanguageModel } from "../src/index.js";
import { anthropic } from "../src/anthropic/index.js";
import { createDevServer } from "../src/server/index.js";
import { z } from "zod";

const live = !!process.env.ANTHROPIC_API_KEY;

/** A canned model: emit a fixed plan, then stream a fixed answer word-by-word. */
function canned(plan: unknown, answer: string): LanguageModel {
  return {
    provider: "local",
    modelId: "canned",
    async complete() {
      return JSON.stringify(plan);
    },
    async *stream() {
      for (const w of answer.split(" ")) yield { textDelta: w + " " };
    },
  };
}

// --- WeatherBot: weather → PDF + web page ---------------------------------

const weatherTools = {
  get_weather: createTool({
    id: "get_weather",
    description: "Look up the current weather for a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, tempF: 72, condition: "sunny", humidity: 41 }),
  }),
  generate_pdf: createTool({
    id: "generate_pdf",
    description: "Render a report object into a PDF file",
    inputSchema: z.object({ report: z.any() }),
    execute: async ({ report }) => ({ path: "/tmp/report.pdf", bytes: JSON.stringify(report).length }),
  }),
  generate_webpage: createTool({
    id: "generate_webpage",
    description: "Render a report object into an HTML page",
    inputSchema: z.object({ report: z.any() }),
    execute: async () => ({ url: "/report.html" }),
  }),
};

const weatherPlan = {
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

const WeatherBot = new Agent({
  name: "WeatherBot",
  instructions: "You are a helpful weather assistant. Use the tools, then reply concisely.",
  model: live ? anthropic("claude-haiku-4-5-20251001") : canned(weatherPlan, "It's 72°F and sunny in NYC (41% humidity). The PDF and web page are ready."),
  tools: weatherTools,
});

// --- ResearchBot: fetch a page → summarise --------------------------------

const researchTools = {
  fetch_url: createTool({
    id: "fetch_url",
    description: "Fetch the text content at a URL",
    inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }) => ({ url, text: "…fetched page body…", bytes: 8423 }),
  }),
};

const researchPlan = {
  plan_id: "research",
  handles: [
    { name: "page", type: "Document", projection: "OPAQUE", origin: "n0" },
    { name: "answer", type: "str", projection: "TRANSPARENT", origin: "n1" },
  ],
  nodes: [
    { id: "n0", kind: "skill", skill: "fetch_url@1", args: { url: "https://example.com" }, outputs: ["page"] },
    { id: "n1", kind: "summarise", inputs: ["page"], outputs: ["answer"] },
  ],
  exits: ["answer"],
};

const ResearchBot = new Agent({
  name: "ResearchBot",
  instructions: "You research the web. Fetch the page, then summarise it for the user.",
  model: live ? anthropic("claude-haiku-4-5-20251001") : canned(researchPlan, "Here's a summary of the page: it's a short example document with no notable content."),
  tools: researchTools,
});

createDevServer({ agents: { WeatherBot, ResearchBot }, port: 4000 });
if (!live) console.log("(no ANTHROPIC_API_KEY — using canned local models; set the key for real runs)");
