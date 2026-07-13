# Contributing to oya

Thanks for your interest. `oya` is early and we welcome help — providers, the
agent DX, streaming, and the playground.

## Setup

A Bun-workspaces monorepo (`packages/core` = `oyadotai`, `packages/server` =
`oyadotai-server`, `apps/playground` = the Next.js studio, `benchmarks`). Built and
tested with [Bun](https://bun.sh) (≥ 1.1); a `Makefile` drives it.

```bash
make install
make test        # bun:test (core)
make typecheck   # every package
make build       # publishable libs + playground
make dev         # oya Studio at localhost:4000
make example     # the weather example, no network
```

## The correctness oracle

The core runtime is a TypeScript port of the Python reference implementation
[`oya-planner`](https://github.com/oya-labs). **The test suite under `test/`
mirrors the reference's tests one-for-one** and is the source of truth for runtime
behaviour. If you change the runtime:

- keep the mirrored tests green, and
- when you fix a behavioural difference from the reference, add a test that pins
  it.

The headline invariant has its own test (`test/executor.test.ts`): a sentinel
planted in every `OPAQUE` value must never appear in the planner-facing view.
Don't weaken it.

## Design notes for porters

- The IR (`src/ir.ts`) is hand-rolled (not zod) so it can faithfully reproduce
  the LLM-output tolerance of the reference: `{param: handle}` maps, `null`
  positional placeholders, the `else` branch alias, projection-name coercion.
- The executor, sandbox, and planner are **async** (a deliberate divergence from
  the synchronous Python — real skills do I/O).
- Projection levels are enforced by a **static check before execution**
  (`src/checker.ts`) plus the projected view (`src/view.ts`). New node kinds must
  declare their disclosure requirement in `src/projection/validation.ts`.

## Pull requests

- One logical change per PR; include tests.
- Run `bun run typecheck && bun test && bun run build` before pushing.
- Conventional, present-tense commit subjects (e.g. `add anthropic provider`).

By contributing you agree your work is licensed under the project's [MIT
license](./LICENSE).
