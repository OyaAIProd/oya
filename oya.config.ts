// Sample agents for oya Studio. Launch with:
//
//   make dev                                    # builds the libs, then starts Studio
//   ANTHROPIC_API_KEY=sk-... bunx oyadotai dev  # if the libs are already built
//
// Studio opens at http://localhost:4000 - chat with the agent and watch each plan
// execute: the DAG, the trace, and every value at its projection level (OPAQUE
// values stay hidden from the model; TRANSPARENT ones are shown).
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

const getWeather = createTool({
  id: "get_weather",
  description: "Look up the current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, tempF: 72, condition: "sunny", humidity: 41 }),
});

const generatePdf = createTool({
  id: "generate_pdf",
  description: "Render a report object into a PDF file",
  inputSchema: z.object({ report: z.any() }),
  execute: async ({ report }) => ({ path: "/tmp/report.pdf", bytes: JSON.stringify(report).length }),
});

const generateWebpage = createTool({
  id: "generate_webpage",
  description: "Render a report object into an HTML page",
  inputSchema: z.object({ report: z.any() }),
  execute: async ({ report }) => ({ url: "/report.html", bytes: JSON.stringify(report).length }),
});

export default {
  agents: {
    weatherBot: new Agent({
      name: "WeatherBot",
      instructions: "Use the tools to complete the request, then reply with a short summary.",
      model: anthropic("claude-haiku-4-5-20251001"),
      tools: { get_weather: getWeather, generate_pdf: generatePdf, generate_webpage: generateWebpage },
    }),
  },
};
