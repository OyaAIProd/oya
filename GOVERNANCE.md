# Governance

oya is an open-source project stewarded by **Oya Labs, Inc.**, and it is the core
library that the hosted platform at [oya.ai](https://oya.ai) is built on. This
document explains how decisions get made so contributors know what to expect.

## Roles

- **Users** — anyone using `oyadotai`. Feedback, bug reports, and questions in
  [Discussions](https://github.com/OyaAIProd/oya/discussions) are contributions
  and are valued.
- **Contributors** — anyone who opens a PR, files a well-scoped issue, improves
  docs, or helps others. You don't need permission to start; just follow
  [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Maintainers** — trusted contributors with merge rights. They triage issues,
  review PRs, and safeguard the project's invariants (see below). Maintainers are
  currently the Oya Labs core team; we add community maintainers as trust is
  earned through sustained, high-quality contribution.

## How decisions are made

- **Everyday changes** (bug fixes, providers, docs, tests) — a maintainer review
  and a green CI run are enough to merge.
- **Notable changes** (public API, the Plan IR, projection semantics, new node
  kinds) — open an issue or Discussion first. These need agreement from at least
  one maintainer and a look from a second, because they affect everyone building
  on oya and, downstream, oya.ai.
- **Disagreements** — we aim for lazy consensus: a proposal with no sustained
  objection after reasonable time moves forward. When consensus can't be reached,
  the Oya Labs core team makes the final call, in the open, with reasoning.

## Non-negotiable invariants

Some properties are the whole point of the project and will not be traded away for
convenience. A change that weakens one will be declined:

- **`OPAQUE` never leaks.** No value marked `OPAQUE` (nor a sentinel planted in
  one) may appear in the planner-facing view. Pinned by
  `packages/core/test/executor.test.ts`.
- **Disclosure is checked before execution.** A plan cannot run with a disclosure
  it did not statically declare (`packages/core/src/checker.ts`).
- **Reference parity.** The runtime mirrors the `oya-planner` reference
  implementation; the mirrored tests are the source of truth for behavior.

## Becoming a maintainer

Show up consistently: review others' PRs, land non-trivial changes, help triage,
and be constructive in discussion. When a contributor has a track record, a
current maintainer nominates them and the core team confirms.

## Relationship to oya.ai

The library is and will remain MIT-licensed and independently usable. oya.ai is a
hosted product built on top of it. Improvements to the open-source core benefit
both, and we develop the two in the open here. Product-specific work for the
hosted platform lives outside this repo.

Questions about governance? Email **mk@oya.ai** or open a Discussion.
