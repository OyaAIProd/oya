# Model Providers

An oya `Agent` takes a `model`. oya ships three provider adapters - Anthropic,
OpenAI, and Google - each a small function that returns a `LanguageModel`. They're
interchangeable: the rest of your agent (tools, instructions, `generate` /
`stream`) stays identical no matter which one plans.

Each provider is a separate entry point, so you only pull in what you use:

```ts
import { anthropic } from "oyadotai/anthropic";
import { openai } from "oyadotai/openai";
import { google } from "oyadotai/google";
```

## Anthropic

Reads `ANTHROPIC_API_KEY` from the environment unless you pass `apiKey`.

```ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";

const agent = new Agent({
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: { get_weather: getWeather },
});

const { text } = await agent.generate("How's the weather in NYC?");
```

## OpenAI

Reads `OPENAI_API_KEY` from the environment unless you pass `apiKey`.

```ts
import { Agent } from "oyadotai";
import { openai } from "oyadotai/openai";

const agent = new Agent({
  model: openai("gpt-4o"),
  tools: { get_weather: getWeather },
});
```

## Google

Reads `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from the environment unless you pass
`apiKey`.

```ts
import { Agent } from "oyadotai";
import { google } from "oyadotai/google";

const agent = new Agent({
  model: google("gemini-2.5-pro"),
  tools: { get_weather: getWeather },
});
```

## Passing the key explicitly

Every provider accepts an options object with `apiKey`, so you don't have to rely
on environment variables - useful in serverless or multi-tenant setups:

```ts
anthropic("claude-haiku-4-5-20251001", { apiKey: process.env.MY_ANTHROPIC_KEY });
openai("gpt-4o", { apiKey: myKey });
google("gemini-2.5-pro", { apiKey: myKey });
```

If no key is found, the provider throws a clear error naming the environment
variable to set.

## Swapping providers

Because the provider is just the `model` value, switching is a one-line change -
your tools, instructions, and the plan-once execution model are unchanged:

```diff
- model: anthropic("claude-haiku-4-5-20251001"),
+ model: openai("gpt-4o"),
```

The model only ever emits the plan; from there the runtime executes the DAG the
same way regardless of which provider planned it. See
[Projection Types](/concepts/projection-types) for what the model does and doesn't
get to see.
