---
layout: home

hero:
  name: oya
  text: Plan, don't react.
  tagline: The model emits a typed dataflow plan once. The runtime executes it. The model never reads state it shouldn't have read.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why projection types
      link: /concepts/projection-types
    - theme: alt
      text: GitHub
      link: https://github.com/OyaAIProd/oya

features:
  - title: OPAQUE by default
    details: Every value is a typed handle the planner sees only at its declared projection level. URLs, IDs, documents, credentials stay OPAQUE - type and provenance only, never the bytes.
  - title: Ordering by construction
    details: The runtime executes a checked DAG in topological order. Inversion, skipping, and interleaving of dependent steps are not paths the runtime can take.
  - title: Prompt injection, closed at the root
    details: An attacker can stuff a payload into any upstream content, but the planner never reads that handle. A whole class of indirect prompt-injection attacks becomes inexpressible.
  - title: ~⅓ the tokens
    details: The model emits the plan once, then steps out of the loop. Intermediate state is piped between skills server-side, not re-billed at token prices.
---
