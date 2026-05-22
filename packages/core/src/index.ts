/**
 * oya — a plan-don't-react framework for LLM agents.
 *
 * The planner model emits a typed dataflow `Plan` once; the runtime executes it;
 * and the model never sees state it should not have read. This module is the
 * core runtime: the Plan IR, the projection lattice, the static checker, the
 * executor, and the planner loop. The TypeScript port of the `oya-planner`
 * reference implementation of *Plan, Don't React: Projection Types for LLM Agent
 * Runtimes*.
 */

// projection lattice
export {
  Projection,
  DEFAULT,
  projectionName,
  parseProjection,
  subsumes,
} from "./projection/level.js";
export * as projector from "./projection/projector.js";
export * as projection from "./projection/index.js";
export { ProjectionError } from "./projection/validation.js";

// type system
export { Type, parseType, isSubtype, isSubtypeStr, PRIMITIVES } from "./types.js";

// Plan IR
export {
  MISSION_HANDLE,
  SkillRef,
  Handle,
  NodeBase,
  SkillNode,
  ExtractNode,
  BranchNode,
  ForEachNode,
  SummariseNode,
  ReplanNode,
  SubplanNode,
  nodeFromJSON,
  SkillEntry,
  CatalogSnapshot,
  Mission,
  CostBudget,
  Plan,
} from "./ir.js";
export type { Inputs, Node, NodeKind } from "./ir.js";

// static checker
export { check, CheckError, CheckResult } from "./checker.js";

// skills + sandbox
export { Skill, Catalog, skill, createTool } from "./skills.js";
export type {
  SkillFn,
  SkillInit,
  SkillConfig,
  CreateToolOptions,
  ToolExecutionContext,
} from "./skills.js";
export { InProcessSandbox, WorkerSandbox } from "./sandbox.js";
export type { Sandbox, SandboxOutcome } from "./sandbox.js";

// executor + view
export { Executor, ExecutionResult, SkillError } from "./executor.js";
export type { LLMRunner } from "./executor.js";
export { plannerView, projectHandle } from "./view.js";
export type { HandleTable } from "./view.js";

// planner
export { Planner, PlannerResult, normalizeProjections, parseJSON } from "./planner.js";
export type { LLMClient, PlannerOptions, PlannerUsage } from "./planner.js";

// high-level agent surface
export { Agent } from "./agent.js";
export type { AgentOptions, AgentResult, GenerateResult } from "./agent.js";
export type { LanguageModel, ModelResponse, ModelUsage, ModelStreamChunk } from "./model.js";

// streaming
export { EventStream } from "./stream.js";
export type { OyaEvent, StreamResult } from "./stream.js";
