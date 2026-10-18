import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NA = "n/a";
const text = (v) => (typeof v === "string" && v !== "" ? v : NA);
const int = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : NA);
const usd = (v) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(4)}` : NA);

// One human-readable line for the job summary. Cost is list-price and notional: the owner pays via a subscription.
export function summarizeRecord(record) {
  const r = record && typeof record === "object" ? record : {};
  const tokens = [r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens].map(int).join("/");
  return [
    `Run ${text(r.run_id)}`,
    `${text(r.skill)} ${text(r.mode)}`,
    text(r.model),
    text(r.outcome),
    `${int(r.turns)} turns`,
    `${int(r.duration_s)}s`,
    `cost ≈ ${usd(r.cost_usd)} (list price, notional — billed to the subscription)`,
    `tokens in/out/cache-read/cache-write = ${tokens}`,
  ].join(" · ");
}

// CLI: node summarize-record.mjs  (reads one record JSON from stdin)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(summarizeRecord(JSON.parse(readFileSync(0, "utf8"))));
}
