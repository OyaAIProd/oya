<!--
Thanks for contributing to oya! Please fill this out so reviewers can move fast.
Keep PRs to one logical change. Link the issue it closes.
-->

## What & why

<!-- What does this change do, and why? Link related issues: "Closes #123". -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Docs / examples only
- [ ] Internal / refactor (no user-facing change)

## Checklist

- [ ] One logical change; the PR title reads as a present-tense commit subject
      (e.g. `add openai provider`)
- [ ] `bun run typecheck && bun test && bun run build` all pass locally
- [ ] Added or updated tests for the change
- [ ] If the runtime changed, the mirrored reference tests under
      `packages/core/test/` still pass (see [CONTRIBUTING](../CONTRIBUTING.md#the-correctness-oracle))
- [ ] I did **not** weaken the `OPAQUE`-never-leaks invariant
      (`packages/core/test/executor.test.ts`)
- [ ] Updated docs (`docs/`) and both READMEs if user-facing behavior changed

## Notes for reviewers

<!-- Anything worth calling out: tradeoffs, follow-ups, areas you're unsure about. -->
