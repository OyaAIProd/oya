# The Plan IR

The Plan IR is a **typed dataflow graph** the planner model emits once, the
runtime executes deterministically, and a static pass can analyse without
invoking the model. It is the structure that token-loop agents lack: a place to
put the question "is this value safe for the model to read?", because it carries
variables in the first place.

## Top-level shape

```jsonc
{
  "plan_id": "…",
  "mission": { "kind": "user_request", "content": "…" },
  "catalog_snapshot": { "hash": "…", "skills": [ /* name@version + sigs */ ] },
  "handles": [
    { "name": "lead", "type": "CRMRecord", "projection": "OPAQUE", "origin": "node:1" }
  ],
  "nodes": [
    { "id": "node:1", "kind": "skill", "skill": "lookup_lead@3",
      "inputs": { "lead_id": "lead_id" }, "outputs": ["lead"] }
  ],
  "exits": ["ack"]
}
```

## Handles

Every named value is a **handle** with a unique `name`, a `type`, a `projection`
level, and an `origin` (the producing node). A handle is **sealed** when its
producing node completes; its value is then immutable and read downstream at the
declared projection level. `mission` is an implicit `TRANSPARENT` handle.

## Node kinds

| Kind | Semantics | Re-engages the model? |
|---|---|---|
| `skill` | invokes a named, versioned catalogue skill | no |
| `extract` | typed extraction from a `TRANSPARENT` input | yes, scoped to the node |
| `branch` | conditional over a `SUMMARY`/`TRANSPARENT` predicate | no |
| `for_each` | bounded iteration over an enumerable | no |
| `summarise` | a `TRANSPARENT` summary for the user | yes, scoped to the node |
| `replan` | runtime-inserted on a failure/drift event | yes |
| `subplan` | references another plan by id; executes opaquely | no |

A node binds a skill's parameters two ways: `inputs` are **handle references**
(values produced by other nodes) and `args` are **literal constants** you supply
directly. Each parameter is filled by one or the other, never both.

## The eight static checks

Before any execution, every plan must pass:

1. **Acyclic** — the dataflow graph is a DAG.
2. **All handles produced** — every handle has exactly one producing node.
3. **All handles consumed** — every handle flows downstream or appears in `exits`.
4. **Type correctness** — every edge's source type is a subtype of the target's.
5. **Projection consistency** — no node reads a handle below its required level.
6. **Skill availability** — every `name@version` resolves in the catalogue snapshot.
7. **Boundedness** — every `for_each` has a statically known upper bound.
8. **Cost budget** — worst-case cost is within the per-mission budget.

A plan that fails any check is rejected with a structured error, and the planner
is asked to re-emit. The IR tolerates the messy shapes real models emit —
`{param: handle}` maps, `null` positional placeholders, the `else` branch alias —
and normalises them before checking.

## Why a typed IR

The Plan IR borrows the **optimiser/executor split** from database query planners
(Calcite's `RelNode`, Spark's `LogicalPlan`) and adds projection types as
first-class column metadata. It replaces the *transcript*, not the planner:
planning, summarisation, and recovery still happen in the model.
