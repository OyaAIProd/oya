/**
 * Benchmark tasks. Each task is a mission + a set of tools (identical impls used
 * by all three frameworks). `weather` is light; `research` is heavy - it fetches
 * several large documents and chains many steps, which is where a token loop
 * (re-sending every result each step) blows up and oya (handles stay OPAQUE)
 * doesn't.
 */

import { z, type ZodTypeAny } from "zod";

export interface ToolSpec {
  id: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (input: any) => unknown;
}

/** A required-order edge: `tool` may only run after every tool in `after`. */
export type Deps = Record<string, string[]>;

/**
 * A state-fidelity assertion: when `tool` runs, the value it received for
 * parameter `param` MUST deep-equal the canonical value the source tool emitted
 * (recorded in the ledger under `equals`). Any drift = state corruption - the
 * failure mode a ReAct loop introduces by re-emitting values as tool arguments.
 */
export interface ProvenanceCheck {
  tool: string;
  param: string;
  equals: string;
}

export interface Task {
  name: string;
  mission: string;
  tools: ToolSpec[];
  /** Correctness spec (optional; drives the accuracy metrics). */
  deps?: Deps;
  required?: string[];
  provenance?: ProvenanceCheck[];
}

// --- provenance ledger -----------------------------------------------------
// The instrumented tools write here so the harness can check, after each run,
// whether values flowed through uncorrupted and in the declared order. A run is
// sequential, so a single module-level ledger reset per run is safe.

export interface Ledger {
  /** Canonical values a source tool produced, keyed by name. */
  emitted: Record<string, unknown>;
  /** Every value a consuming tool actually received. */
  received: { tool: string; param: string; value: unknown }[];
}
export const ledger: Ledger = { emitted: {}, received: [] };
export function resetLedger(): void {
  ledger.emitted = {};
  ledger.received = [];
}
function recordReceived(tool: string, input: Record<string, unknown>): void {
  for (const [param, value] of Object.entries(input)) ledger.received.push({ tool, param, value });
}

// --- weather (light) -------------------------------------------------------

const weather = () => ({ city: "NYC", tempF: 72, condition: "sunny", humidity: 41, windMph: 8, station: "KNYC" });

export const weatherTask: Task = {
  name: "weather",
  mission: "How's the weather in NYC? Then generate a PDF and a web page.",
  tools: [
    { id: "get_weather", description: "Look up the current weather for a city", inputSchema: z.object({ city: z.string() }), execute: () => weather() },
    { id: "generate_pdf", description: "Render a report object into a PDF file", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ path: "/tmp/weather.pdf", bytes: JSON.stringify(report).length }) },
    { id: "generate_webpage", description: "Render a report object into an HTML page", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ url: "/weather.html", bytes: JSON.stringify(report).length }) },
  ],
};

// --- research (heavy: large documents, many steps) -------------------------

// A realistic ~2KB article body - the kind of payload a token loop re-sends on
// every subsequent step, and re-emits as tool arguments to use it.
const PARA =
  "Green tea is rich in polyphenols such as epigallocatechin gallate (EGCG), which act as antioxidants and have been studied for effects on metabolism, cardiovascular markers, and cellular stress. Observational cohorts report associations with modest changes in LDL cholesterol and blood pressure, though randomized trials are smaller and more mixed. Caffeine and L-theanine together are associated with alertness and calm. Effects depend on dose, brewing time, and individual variation. ";
const ARTICLE = PARA.repeat(5); // ~2KB

export const researchTask: Task = {
  name: "research",
  mission:
    "Research the health benefits of green tea: search the web, read the top 3 sources, write a thorough report, then publish it as a PDF and as a web page. Reply with a short summary.",
  tools: [
    {
      id: "search",
      description: "Search the web; returns the top results (title + url)",
      inputSchema: z.object({ query: z.string() }),
      execute: ({ query }) => ({
        query,
        results: [
          { title: "Green tea and health - review", url: "https://ex.org/a" },
          { title: "EGCG: a meta-analysis", url: "https://ex.org/b" },
          { title: "Caffeine + L-theanine", url: "https://ex.org/c" },
        ],
      }),
    },
    {
      id: "fetch_page",
      description: "Fetch the full text of a page by url",
      inputSchema: z.object({ url: z.string() }),
      execute: ({ url }) => ({ url, title: "Source " + url, content: ARTICLE + " (" + url + ")" }),
    },
    {
      id: "write_report",
      description: "Write a long markdown report from notes/sources",
      inputSchema: z.object({ notes: z.any() }),
      execute: ({ notes }) => ({
        markdown: "# Green Tea: Health Benefits\n\n" + ARTICLE + ARTICLE + "\n\nSources: " + JSON.stringify(notes).slice(0, 80),
        words: 600,
      }),
    },
    { id: "publish_pdf", description: "Publish a report as a PDF", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ path: "/tmp/green-tea.pdf", bytes: JSON.stringify(report).length }) },
    { id: "publish_web", description: "Publish a report as a web page", inputSchema: z.object({ report: z.any() }), execute: ({ report }) => ({ url: "/green-tea.html", bytes: JSON.stringify(report).length }) },
  ],
};

// --- payments (accuracy: state fidelity + order) ---------------------------
// A clean linear pipeline - lookup -> charge -> email - where each tool consumes
// a WHOLE record produced upstream (createTool skills are single-output, so oya
// wires each record as one OPAQUE handle). The values are distinctive and
// corruption-prone: a long signed URL, a mixed-case id, a raw cents integer.
//
//   oya  : the records are OPAQUE handles the planner wires by name - the model
//          NEVER re-emits them, so what `charge_invoice` / `email_receipt`
//          receive is byte-identical to what `lookup_order` produced. 0 by
//          construction.
//   loop : the model must re-type each record as the next tool's arguments -
//          the re-tokenisation the paper names - so a field can silently drift.

// Deliberately long, high-entropy values - a full UUID, a long numeric account
// reference, and a long signed URL. The longer and more random the string, the
// more likely the model re-types it wrong: a dropped digit, a transposed hex
// pair, a truncated signature. The amount stays a REALISTIC sum (an absurd one
// makes a careful model refuse to charge rather than corrupt anything). oya never
// re-types these, so its fidelity is length-independent.
const INVOICE = {
  invoice_id: "INV-3f9a1c2e-8b7d-4e6f-a1b2-9c8d7e6f5a4b-2024Q3",
  account_ref: "4829174699305521883701",
  amount_cents: 9042731,
  receipt_url:
    "https://pay.acme-industries.io/r/3f9a1c2e8b7d4e6fa1b29c8d7e6f5a4b/receipts/2024-q3/d41d8cd98f00b204e9800998ecf8427e.pdf?sig=Zq7XkP2mN9wL3vB8tR4yH1jF6sD0aG5cV2bN7mK9pQ4wE&exp=1789012345678&v=3",
};
const invoiceShape = z.object({
  invoice_id: z.string(),
  account_ref: z.string(),
  amount_cents: z.number(),
  receipt_url: z.string(),
});

export const paymentsTask: Task = {
  name: "payments",
  mission:
    "You are an automated billing agent, authorized to run this billing cycle end to end without asking for confirmation. Look up the open invoice for customer 'acme-industries', charge that invoice, then email the receipt to the customer. Complete all three steps, then reply with a one-line confirmation.",
  tools: [
    {
      id: "lookup_order",
      description: "Look up the open invoice record for a customer. Returns the full invoice object.",
      inputSchema: z.object({ customer: z.string() }),
      execute: () => {
        ledger.emitted.invoice = { ...INVOICE };
        return { ...INVOICE };
      },
    },
    {
      id: "charge_invoice",
      description: "Charge an invoice. Pass the invoice object returned by lookup_order. Returns the charge record.",
      inputSchema: z.object({ invoice: invoiceShape }),
      execute: (input: { invoice: { invoice_id: string; account_ref: string; amount_cents: number } }) => {
        recordReceived("charge_invoice", input);
        const charge = { charge_id: "CHG-" + input.invoice.invoice_id, account_ref: input.invoice.account_ref, amount_cents: input.invoice.amount_cents };
        ledger.emitted.charge = { ...charge };
        return charge;
      },
    },
    {
      id: "email_receipt",
      description: "Email the receipt to the customer. Pass the invoice object (from lookup_order) and the charge object (from charge_invoice).",
      inputSchema: z.object({
        invoice: invoiceShape,
        charge: z.object({ charge_id: z.string(), account_ref: z.string(), amount_cents: z.number() }),
      }),
      execute: (input: Record<string, unknown>) => {
        recordReceived("email_receipt", input);
        return { sent: true };
      },
    },
  ],
  deps: { charge_invoice: ["lookup_order"], email_receipt: ["charge_invoice"] },
  required: ["lookup_order", "charge_invoice", "email_receipt"],
  provenance: [
    { tool: "charge_invoice", param: "invoice", equals: "invoice" },
    { tool: "email_receipt", param: "invoice", equals: "invoice" },
    { tool: "email_receipt", param: "charge", equals: "charge" },
  ],
};

// --- reconcile (accuracy, paper-faithful: distractor + bulky payload) --------
// Ported from PlanBench (papers/plan-dont-react, `ops` domain). A low-frequency
// critical token is produced by the first tool, then threads through
// fetch → normalize → validate → post_update, which must receive it
// BYTE-FOR-BYTE. `fetch_record` returns a BULKY payload carrying a look-alike
// DISTRACTOR id - the trick that tempts a token loop into re-emitting the wrong
// or mangled token, even on a strong model (mere length does not; the distractor
// does). oya wires the token handle straight from `get_transaction` to
// `post_update` and never reads the record, so it can neither grab the distractor
// nor corrupt the token - 0 by construction.

const TXN = "TXN-7f3a9c2e-8b1d-4e6f-a1b2-9c8d7e6f5a4b";
// A *look-alike* related id - same shape, differs only in the middle segments -
// the "distractor" the paper uses to tempt a wrong/blended copy. Distinct enough
// to be a different transaction, close enough that a model re-typing from memory
// can drift toward it.
const TXN_DISTRACTOR = "TXN-7f3a9c2e-8b1d-4e6f-c3d4-9c8d7e6f5a4b";
const BULKY = "META" + "z7Q2".repeat(400); // ~1.6 KB filler re-sent through a loop's context every turn

export const reconcileTask: Task = {
  name: "reconcile",
  mission:
    "You are an automated ledger agent, authorized to run this reconciliation end to end without asking for confirmation. Get the open transaction for account 'acme-ops', fetch its full record, normalize it, validate it, then post the reconciliation for that transaction. Complete every step, then reply with a one-line confirmation.",
  tools: [
    {
      id: "get_transaction",
      description: "Get the id of the open transaction for an account.",
      inputSchema: z.object({ account: z.string() }),
      execute: () => {
        ledger.emitted.txn = TXN;
        return TXN; // the single critical token the pipeline must preserve
      },
    },
    {
      id: "fetch_record",
      description: "Fetch the full record for a transaction id. Returns the record object.",
      inputSchema: z.object({ txn_id: z.string() }),
      execute: () => ({
        related_txn: TXN_DISTRACTOR,
        amount_cents: 421000,
        currency: "USD",
        raw: BULKY,
      }),
    },
    {
      id: "normalize_record",
      description: "Normalize a fetched record. Pass the record object returned by fetch_record.",
      inputSchema: z.object({
        record: z.object({ related_txn: z.string(), amount_cents: z.number(), currency: z.string(), raw: z.string() }),
      }),
      execute: ({ record }: { record: { raw: string } }) => ({ normalized: true, summary_len: record.raw.length }),
    },
    {
      id: "validate_record",
      description: "Validate a normalized record. Pass the output of normalize_record.",
      inputSchema: z.object({ normalized: z.object({ normalized: z.boolean(), summary_len: z.number() }) }),
      execute: () => ({ ok: true }),
    },
    {
      id: "post_update",
      description: "Post the reconciliation for the transaction being processed. Requires the validation result and the transaction id.",
      inputSchema: z.object({ validation: z.object({ ok: z.boolean() }), txn_id: z.string() }),
      execute: (input: { txn_id: string }) => {
        recordReceived("post_update", { txn_id: input.txn_id });
        return { posted: true, txn_id: input.txn_id };
      },
    },
  ],
  deps: {
    fetch_record: ["get_transaction"],
    validate_record: ["normalize_record"],
    post_update: ["get_transaction", "validate_record"],
  },
  required: ["get_transaction", "fetch_record", "normalize_record", "validate_record", "post_update"],
  provenance: [{ tool: "post_update", param: "txn_id", equals: "txn" }],
};

export const TASKS: Record<string, Task> = {
  reconcile: reconcileTask,
  payments: paymentsTask,
  weather: weatherTask,
  research: researchTask,
};
