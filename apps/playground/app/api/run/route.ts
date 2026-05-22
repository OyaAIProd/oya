import { toSSEResponse } from "@oya/server";

import { agents } from "../../../lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { agent, prompt } = (await req.json()) as { agent?: string; prompt: string };
  const a = (agent && agents[agent]) || Object.values(agents)[0];
  if (!a) return new Response("no agents registered", { status: 404 });
  return toSSEResponse(a.stream(prompt).fullStream);
}
