/**
 * Sandboxing for skill execution.
 *
 * Ported from `oya_planner/sandbox.py` (spec/plan-ir.md §7). One isolated
 * sandbox per invocation with capability-based egress (the egress policy lands
 * in a later phase). Two implementations:
 *
 *   - `InProcessSandbox` - the default. Runs the skill in-process with
 *     wall-clock accounting. Appropriate for trusted, first-party skills, where
 *     the projection lattice - not the sandbox - carries the security claim.
 *   - `WorkerSandbox` - runs a self-contained skill function in a worker thread,
 *     the seam where resource caps and egress policy attach for untrusted /
 *     synthesised skills.
 *
 * The executor takes a sandbox by injection so the isolation strategy is a
 * deployment choice, not baked into the runtime.
 */

import type { Skill } from "./skills.js";

export interface SandboxOutcome {
  value: unknown;
  seconds: number;
}

export interface Sandbox {
  run(skill: Skill, kwargs: Record<string, unknown>): Promise<SandboxOutcome>;
}

/** Run skills in-process. Measures wall-clock cost. */
export class InProcessSandbox implements Sandbox {
  async run(skill: Skill, kwargs: Record<string, unknown>): Promise<SandboxOutcome> {
    const start = performance.now();
    const value = await skill.fn(kwargs);
    return { value, seconds: (performance.now() - start) / 1000 };
  }
}

/**
 * Run a self-contained skill function in a worker thread.
 *
 * Like the Python `SubprocessSandbox` (spawn semantics), the skill's `fn` must be
 * self-contained - it is shipped to the worker by source and cannot close over
 * outer variables. This is the attachment point for resource caps and egress
 * restriction on untrusted skills.
 */
export class WorkerSandbox implements Sandbox {
  constructor(private readonly timeoutMs = 30_000) {}

  async run(skill: Skill, kwargs: Record<string, unknown>): Promise<SandboxOutcome> {
    const { Worker } = await import("node:worker_threads");
    const start = performance.now();
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        try {
          const fn = (${skill.fn.toString()});
          const value = await fn(workerData.kwargs);
          parentPort.postMessage({ status: 'ok', value });
        } catch (err) {
          parentPort.postMessage({ status: 'err', message: String(err && err.message || err) });
        }
      })();
    `;
    return await new Promise<SandboxOutcome>((resolve, reject) => {
      const worker = new Worker(source, { eval: true, workerData: { kwargs } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error(`skill ${skill.ref} exceeded ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      worker.on("message", (msg: { status: string; value?: unknown; message?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (msg.status === "err") {
          reject(new Error(msg.message));
        } else {
          resolve({ value: msg.value, seconds: (performance.now() - start) / 1000 });
        }
      });
      worker.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
