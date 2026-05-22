/**
 * Benchmark tasks. Each task is a mission + a set of tools (identical impls used
 * by all three frameworks). `weather` is light; `research` is heavy — it fetches
 * several large documents and chains many steps, which is where a token loop
 * (re-sending every result each step) blows up and oya (handles stay OPAQUE)
 * doesn't.
 */

import { z, type ZodTypeAny } from "zod";

export interface ToolSpec {
  id: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (input: any) => unknown;
}
export interface Task {
  name: string;
  mission: string;
  tools: ToolSpec[];
}

// --- weather (light) -------------------------------------------------------

const weather = () => ({ city: "NYC", tempF: 72, condition: "sunny", humidity: 41, windMph: 8, station: "KNYC" });

export const weatherTask: Task = {
  name: "weather",
  mission: "How's the weather in NYC? Then generate a PDF and a web page.",
  tools: [
    { id: "get_weather", description: "Look up the current weather for a city", inputSchema: z.object({ city: z.string() }), execute: () => weather() },
    { id: "generate_pdf", description: "Render a report object into a PDF file", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ path: "/tmp/weather.pdf", bytes: JSON.stringify(report).length }) },
    { id: "generate_webpage", description: "Render a report object into an HTML page", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ url: "/weather.html", bytes: JSON.stringify(report).length }) },
  ],
};

// --- research (heavy: large documents, many steps) -------------------------

// A realistic ~2KB article body — the kind of payload a token loop re-sends on
// every subsequent step, and re-emits as tool arguments to use it.
const PARA =
  "Green tea is rich in polyphenols such as epigallocatechin gallate (EGCG), which act as antioxidants and have been studied for effects on metabolism, cardiovascular markers, and cellular stress. Observational cohorts report associations with modest changes in LDL cholesterol and blood pressure, though randomized trials are smaller and more mixed. Caffeine and L-theanine together are associated with alertness and calm. Effects depend on dose, brewing time, and individual variation. ";
const ARTICLE = PARA.repeat(5); // ~2KB

export const researchTask: Task = {
  name: "research",
  mission:
    "Research the health benefits of green tea: search the web, read the top 3 sources, write a thorough report, then publish it as a PDF and as a web page. Reply with a short summary.",
  tools: [
    {
      id: "search",
      description: "Search the web; returns the top results (title + url)",
      inputSchema: z.object({ query: z.string() }),
      execute: ({ query }) => ({
        query,
        results: [
          { title: "Green tea and health — review", url: "https://ex.org/a" },
          { title: "EGCG: a meta-analysis", url: "https://ex.org/b" },
          { title: "Caffeine + L-theanine", url: "https://ex.org/c" },
        ],
      }),
    },
    {
      id: "fetch_page",
      description: "Fetch the full text of a page by url",
      inputSchema: z.object({ url: z.string() }),
      execute: ({ url }) => ({ url, title: "Source " + url, content: ARTICLE + " (" + url + ")" }),
    },
    {
      id: "write_report",
      description: "Write a long markdown report from notes/sources",
      inputSchema: z.object({ notes: z.any() }),
      execute: ({ notes }) => ({
        markdown: "# Green Tea: Health Benefits\n\n" + ARTICLE + ARTICLE + "\n\nSources: " + JSON.stringify(notes).slice(0, 80),
        words: 600,
      }),
    },
    { id: "publish_pdf", description: "Publish a report as a PDF", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ path: "/tmp/green-tea.pdf", bytes: JSON.stringify(report).length }) },
    { id: "publish_web", description: "Publish a report as a web page", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ url: "/green-tea.html", bytes: JSON.stringify(report).length }) },
  ],
};

export const TASKS: Record<string, Task> = {
  weather: weatherTask,
  research: researchTask,
};
