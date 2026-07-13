/**
 * The agents the playground serves. Real Anthropic when ANTHROPIC_API_KEY is set,
 * otherwise canned local models so the studio runs with no key.
 */

import { Agent, createTool, type LanguageModel } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

const live = !!process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

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

// ─────────────────────────────────────────────────────────────────────────
// Register your agents here. Each key becomes a tab in the studio sidebar and
// is callable at POST /api/run { agent, prompt }. Add an entry and it shows up.
// ─────────────────────────────────────────────────────────────────────────
export const agents: Record<string, Agent> = {
  WeatherBot: new Agent({
    name: "WeatherBot",
    instructions: "You are a helpful weather assistant. Use the tools, then reply concisely.",
    model: live ? anthropic(MODEL) : canned(weatherPlan, "It's 72°F and sunny in NYC (41% humidity). The PDF and web page are ready."),
    tools: weatherTools,
  }),
  ResearchBot: new Agent({
    name: "ResearchBot",
    instructions: "You research the web. Fetch the page, then summarise it for the user.",
    model: live ? anthropic(MODEL) : canned(researchPlan, "Here's a summary of the page: a short example document with no notable content."),
    tools: researchTools,
  }),

  // MyAgent: new Agent({
  //   name: "MyAgent",
  //   instructions: "…",
  //   model: anthropic("claude-haiku-4-5-20251001"),
  //   tools: { my_tool: createTool({ id: "my_tool", inputSchema: z.object({ … }), execute: async (input) => … }) },
  // }),
};
