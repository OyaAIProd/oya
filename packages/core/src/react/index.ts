/**
 * React hooks - `oya/react`.
 *
 * `usePlan` consumes an oya event stream (an SSE endpoint built with
 * `oya/server`) and exposes the live plan: each node's status, the handles it
 * sealed (at their projection level - `OPAQUE` discloses nothing), and the
 * answer as it streams. `useChat` is a message-list convenience on top.
 *
 * React is a peer dependency.
 */

import { useCallback, useState } from "react";

import { sseJSON } from "../_sse.js";
import type { OyaEvent } from "../stream.js";

export interface NodeState {
  nodeId: string;
  kind: string;
  skill?: string;
  status: "pending" | "running" | "done";
  handles?: Record<string, unknown>;
}

export interface PlanState {
  status: "idle" | "streaming" | "done" | "error";
  /** The emitted plan (raw, as it arrived) - for drawing the DAG. */
  plan: unknown | null;
  nodes: NodeState[];
  text: string;
  error: string | null;
  events: OyaEvent[];
}

export const initialPlanState: PlanState = {
  status: "idle",
  plan: null,
  nodes: [],
  text: "",
  error: null,
  events: [],
};

/** Pure reducer: fold one streamed event into the plan state. */
export function applyEvent(state: PlanState, e: OyaEvent): PlanState {
  const events = [...state.events, e];
  switch (e.type) {
    case "plan":
      return {
        ...state,
        events,
        status: "streaming",
        plan: e.plan,
        nodes: e.plan.nodes.map((n) => ({
          nodeId: n.id,
          kind: n.kind,
          skill: (n as { skill?: string }).skill,
          status: "pending",
        })),
      };
    case "node-start":
      return { ...state, events, nodes: setStatus(state.nodes, e.nodeId, "running") };
    case "node-finish":
      return {
        ...state,
        events,
        nodes: state.nodes.map((n) =>
          n.nodeId === e.nodeId ? { ...n, status: "done", handles: e.handles } : n,
        ),
      };
    case "text-delta":
      return { ...state, events, text: state.text + e.delta };
    case "finish":
      return { ...state, events, status: "done" };
    case "error":
      return { ...state, events, status: "error", error: e.error };
    default:
      return { ...state, events };
  }
}

function setStatus(nodes: NodeState[], id: string, status: NodeState["status"]): NodeState[] {
  return nodes.map((n) => (n.nodeId === id ? { ...n, status } : n));
}

export interface UsePlanOptions {
  api: string;
  headers?: Record<string, string>;
}

export interface UsePlanResult extends PlanState {
  /** POST the prompt to the SSE endpoint and stream the run. Resolves to the answer. */
  run: (prompt: string) => Promise<string>;
}

export function usePlan(opts: UsePlanOptions): UsePlanResult {
  const [state, setState] = useState<PlanState>(initialPlanState);

  const run = useCallback(
    async (prompt: string): Promise<string> => {
      setState({ ...initialPlanState, status: "streaming" });
      const res = await fetch(opts.api, {
        method: "POST",
        headers: { "content-type": "application/json", ...opts.headers },
        body: JSON.stringify({ prompt }),
      });
      if (!res.body) throw new Error("oya: response had no body");
      let text = "";
      for await (const raw of sseJSON(res.body)) {
        const e = raw as OyaEvent;
        if (e.type === "text-delta") text += e.delta;
        setState((prev) => applyEvent(prev, e));
        if (e.type === "error") throw new Error(e.error);
      }
      return text;
    },
    [opts.api, opts.headers],
  );

  return { ...state, run };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function useChat(opts: UsePlanOptions) {
  const plan = usePlan(opts);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const send = useCallback(
    async (content: string): Promise<string> => {
      setMessages((m) => [...m, { role: "user", content }]);
      const answer = await plan.run(content);
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
      return answer;
    },
    [plan.run],
  );

  return { messages, send, ...plan };
}
