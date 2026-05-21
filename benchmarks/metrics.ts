export interface Metrics {
  framework: string;
  roundTrips: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  sequence: string[];
  output?: unknown;
}
