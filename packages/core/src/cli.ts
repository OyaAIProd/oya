#!/usr/bin/env bun
/**
 * The `oya` CLI. Today: `oya dev` — start oya Studio against the agents you export
 * from `oya.config.ts` in your project. Runs under Bun (so your TS config loads
 * directly); ships in the `oya` package, so `bunx oya dev` just works.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { STUDIO_HTML } from "./studio-html.js";

type Streamable = { stream: (p: string) => { fullStream: AsyncIterable<unknown> } };

const CONFIG_NAMES = ["oya.config.ts", "oya.config.mts", "oya.config.js", "oya.config.mjs"];

const EXAMPLE = `Create an oya.config.ts in this folder:

  import { Agent } from "oya";
  import { anthropic } from "oya/anthropic";

  export default {
    agents: {
      myAgent: new Agent({
        model: anthropic("claude-haiku-4-5-20251001"),
        tools: { /* ...createTool(...) */ },
      }),
    },
  };
`;

async function loadAgents(): Promise<Record<string, Streamable>> {
  const file = CONFIG_NAMES.map((c) => resolve(process.cwd(), c)).find(existsSync);
  if (!file) {
    console.error(`oya dev: no oya.config.* found in ${process.cwd()}\n\n${EXAMPLE}`);
    process.exit(1);
  }
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const cfg = (mod.default ?? mod) as { agents?: Record<string, Streamable> };
  const agents = (cfg.agents ?? (cfg as unknown as Record<string, Streamable>)) || {};
  const names = Object.keys(agents).filter((k) => typeof (agents[k] as Streamable)?.stream === "function");
  if (!names.length) {
    console.error(`oya dev: ${file} exported no agents.\n\n${EXAMPLE}`);
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, agents[n]]));
}

function sse(stream: AsyncIterable<unknown>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      try {
        for await (const e of stream) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (e) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", error: String(e) })}\n\n`));
      } finally {
        c.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
}

async function dev(argv: string[]) {
  const pi = argv.indexOf("--port");
  const wanted = pi >= 0 ? Number(argv[pi + 1]) : 4000;
  const agents = await loadAgents();
  const names = Object.keys(agents);

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/api/agents") return Response.json(names);
    if (req.method === "POST" && url.pathname === "/api/run") {
      const { agent, prompt } = (await req.json()) as { agent?: string; prompt: string };
      const a = (agent && agents[agent]) || agents[names[0]];
      return sse(a.stream(prompt).fullStream);
    }
    return new Response(STUDIO_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  };

  for (let p = wanted; p < wanted + 10; p++) {
    try {
      const server = Bun.serve({ port: p, fetch: handler });
      console.log(`\n  oya studio → http://localhost:${server.port}`);
      console.log(`  agents: ${names.join(", ")}`);
      if (!process.env.ANTHROPIC_API_KEY) console.log("  (no ANTHROPIC_API_KEY — set it for real model calls)");
      console.log("");
      return;
    } catch (e) {
      if (String((e as Error).message).includes("EADDRINUSE")) continue;
      throw e;
    }
  }
  console.error(`oya dev: no free port near ${wanted}`);
  process.exit(1);
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (cmd === "dev") return dev(argv);
  console.log("oya — plan-don't-react agents\n\nusage:\n  oya dev [--port <n>]   start oya Studio against your oya.config.ts\n");
  process.exit(cmd ? 1 : 0);
}

void main();
