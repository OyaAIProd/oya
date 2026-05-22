# Examples

Runnable examples that need no API key or network.

| File | What it shows |
|---|---|
| [`weather-report.ts`](./weather-report.ts) | "How's the weather in NYC? Then generate a PDF and a web page." — one mission, three `createTool` tools, `Agent.generate`. The model answers the weather question, but the generated PDF and HTML page stay `OPAQUE` and never flow back through it. |

```bash
bun run example      # runs weather-report.ts via Bun (canned local model)
```

Swap the canned model for a real one with `model: anthropic("claude-haiku-4-5-20251001")`
and an `ANTHROPIC_API_KEY`.
