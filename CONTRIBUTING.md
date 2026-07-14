# Contributing to oya

Thanks for your interest - **oya is a community project** and we'd love your help.
It's early, so there's high-leverage work across providers, agent DX, streaming,
the Studio, docs, and examples. This is also the open-source core that
[oya.ai](https://oya.ai) is built on, so improvements here reach a lot of people.

New contributors are welcome. If it's your first PR to an open-source project,
that's fine - say so and we'll help you through it.

## Ways to contribute

- **Report a bug** - open a [bug report](https://github.com/OyaAIProd/oya/issues/new?template=bug_report.yml).
- **Request a feature** - open a [feature request](https://github.com/OyaAIProd/oya/issues/new?template=feature_request.yml),
  or start a [Discussion](https://github.com/OyaAIProd/oya/discussions) for
  anything design-shaped.
- **Improve docs or examples** - often the best first PR.
- **Pick up an issue** - look for [`good first issue`](https://github.com/OyaAIProd/oya/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/OyaAIProd/oya/labels/help%20wanted).
- **Answer questions** and help others in Discussions - this counts, and it's how
  people become maintainers.

For anything beyond a small fix, **open an issue or Discussion before you write a
lot of code** so we can align on the approach - it saves everyone a painful review.

## Ground rules

- Be kind and constructive. All participation is governed by our
  [Code of Conduct](./CODE_OF_CONDUCT.md).
- Governance and how decisions get made are described in [GOVERNANCE.md](./GOVERNANCE.md).
- Report security issues **privately** - see [SECURITY.md](./SECURITY.md), never a
  public issue.

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
(`oya-planner`). **The test suite under `test/` mirrors the reference's tests
one-for-one** and is the source of truth for runtime behaviour. If you change the
runtime:

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
  the synchronous Python - real skills do I/O).
- Projection levels are enforced by a **static check before execution**
  (`src/checker.ts`) plus the projected view (`src/view.ts`). New node kinds must
  declare their disclosure requirement in `src/projection/validation.ts`.

## Pull requests

1. **Fork** the repo and create a branch off `main` (e.g. `feat/openai-tools`,
   `fix/handle-null-input`).
2. Make **one logical change per PR** and include tests.
3. Run the full check locally before pushing:
   ```bash
   bun run typecheck && bun test && bun run build
   ```
4. Write a **conventional, present-tense subject** (e.g. `add anthropic provider`,
   `fix branch alias coercion`). The PR title becomes the squash-merge commit.
5. Open the PR and fill in the template. **Link the issue it closes** (`Closes #NN`).
6. Keep the PR focused and responsive to review - small, well-described PRs merge
   fast.

CI (`.github/workflows/ci.yml`) runs build → typecheck → test on every PR; it must
be green to merge. Every merge to `main` auto-publishes a patch release to npm, so
maintainers keep `main` releasable at all times.

### Review & merge

A maintainer will review - expect a first response within a few days. We may ask
for changes; that's normal and not a rejection. Once approved and green, a
maintainer squash-merges. Notable changes (public API, the Plan IR, projection
semantics) follow the extra process in [GOVERNANCE.md](./GOVERNANCE.md).

## Licensing & sign-off

By contributing, you agree that your work is licensed under the project's
[MIT license](./LICENSE), and you certify that you have the right to submit it
under that license (the [Developer Certificate of Origin](https://developercertificate.org/)).

## Contact

Questions that don't fit an issue or Discussion? Email **mk@oya.ai**.
