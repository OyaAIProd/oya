# Projection Types

In a token-loop agent (ReAct, LangGraph, AutoGen), every intermediate value a
tool produces flows back into the model's context. The model sees every URL,
every ID, every API response. Three failure modes follow directly:

- **State corruption.** The model re-tokenises values that don't look like
  training data. Long URLs get "normalised", UUIDs paraphrased. There is no
  prompt-engineering fix; it is architectural.
- **Ordering drift.** Because the model decides the next step after seeing each
  result, it can interleave, skip, or reorder steps with a strict dependency.
- **Token waste.** Every byte of intermediate state is re-billed at token prices,
  even when the model doesn't need to read it to decide.

The unifying observation: **the model is permitted to read state it should not
have read.** Projection types name what the model may and may not see, per plan
variable, and the runtime enforces the answer.

## The lattice

Every handle carries exactly one projection level:

```
        TRANSPARENT     full value
            │
         SUMMARY        bounded, runtime-generated projection
            │
         OPAQUE         type + provenance only   ← the default
```

| Level | The planner sees | Use for |
|---|---|---|
| `OPAQUE` | the handle exists, its type, and which node produced it - **nothing else** | URLs, IDs, file paths, raw responses, embeddings, credentials, customer data |
| `SUMMARY` | a **bounded, pure** projection (e.g. `{ count, first_item_kind }`) | branching on a coarse fact ("zero, one, or many results?") |
| `TRANSPARENT` | the full value | the user's message; the model's own prose to critique; final outputs |

Higher means more disclosure. **Promotion is explicit and audited** (it's recorded
in the plan); **demotion is free** (the standard lattice subsumption rule).

## OPAQUE by default

A plan that omits a handle's projection gets `OPAQUE`. The planner cannot
accidentally promote a value to `TRANSPARENT` by forgetting to annotate it. Every
disclosure is a deliberate decision in the emitted plan - the projection analogue
of `secrecy = high` in information-flow control.

## Enforcement

The lattice is enforced, not advisory:

- **Static check.** Before execution, the checker rejects any plan where a node
  reads a handle below the level it requires (a `summarise` over an `OPAQUE`
  handle is malformed).
- **Projected view.** The runtime stores every handle at full fidelity but
  exposes each to the planner only at its declared level.
- **Projected errors.** A failing skill yields a typed
  `SkillError{ class, retryable, node_id }` - any partial `OPAQUE` value it
  produced is dropped, never surfaced.
- **Projected replan.** On a failure the planner sees the projected handle table
  plus the typed error - never an `OPAQUE` value, even because something went
  wrong.

## The security corollary

An attacker who controls upstream content (a CRM `notes` field, a fetched page)
can inject any payload. If the handle carrying that content is `OPAQUE`, the
planner never reads it - so a class of indirect prompt-injection attacks that
work against `TRANSPARENT`-by-default agents is **inexpressible** here. Same end
as [CaMeL](https://arxiv.org/abs/2503.18813) and f-secure, reached by a different
mechanism: per-handle metadata on a typed plan IR, checked statically.
