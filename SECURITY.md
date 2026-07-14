# Security Policy

## Supported versions

oya is pre-1.0 and ships from `main`. Security fixes land on the latest published
`oyadotai` / `oyadotai-server` versions on npm. Please always test against the
newest release before reporting.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through either channel:

- **GitHub** — [open a private advisory](https://github.com/OyaAIProd/oya/security/advisories/new)
  (Security → Advisories → *Report a vulnerability*). Preferred.
- **Email** — **mk@oya.ai** with steps to reproduce, affected versions, and
  impact.

We aim to acknowledge reports within **3 business days** and to ship a fix or a
mitigation plan within **90 days**, coordinating disclosure timing with you.

## Scope

oya's core security claim is the **projection lattice**: values marked `OPAQUE`
must never reach the planner-facing view. We are especially interested in:

- Any input that causes an `OPAQUE` value (or a sentinel planted in one) to appear
  in the model-facing context — this is the headline invariant
  (`packages/core/test/executor.test.ts`) and must never be weakened.
- Static-checker bypasses (`packages/core/src/checker.ts`) that let a plan execute
  with a disclosure it didn't declare.
- Sandbox escapes in `WorkerSandbox` / `InProcessSandbox`.
- Prompt-injection paths that reach the planner through tool output.

Out of scope: issues in your own tool `execute` implementations, third-party model
providers, and the hosted platform at [oya.ai](https://oya.ai) (report those to
mk@oya.ai directly).

Thank you for helping keep oya and its users safe.
