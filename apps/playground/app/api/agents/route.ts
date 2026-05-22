import { agents } from "../../../lib/agents";

export const runtime = "nodejs";

export function GET() {
  return Response.json(Object.keys(agents));
}
