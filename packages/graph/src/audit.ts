import type { PackageSignature, TrailRow } from "@xeniur/core";
import { KeyWouldLeak, canonicalJson, describeTrailRow, describeTrust, findKeyShaped, sha256Hex } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { outcomeOf, trustFactsFor } from "./outcomes.js";
import { deliveryReport } from "./portability.js";

/**
 * The audit export — "give me an audit trail".
 *
 * One self-contained HTML file: the delivery report, the Agent Trail, the Outcome Ledger and
 * the process record, in the same visual language, monochrome-safe, readable without XENIUR.
 * A manifest at the end carries the root hash of everything above it and this machine's
 * signature over that hash, so a reader with the public key can check that nothing in the
 * file changed after it was written. Append-only in spirit: the file records; it does not
 * summarise, rank or reassure.
 */
export interface AuditManifest {
  format: "xeniur-audit/1";
  objectId: string;
  title: string;
  generatedAt: number;
  rootHash: string;
  publisher: PackageSignature;
  counts: { trailRows: number; processEvents: number; receipts: number };
}

export function renderAuditPage(graph: ObjectGraph, objectId: string, releaseId?: string): { html: string; manifest: AuditManifest } {
  const state = graph.currentState(objectId);
  if (!state) throw new Error(`no such Object: ${objectId}`);
  const title = state.properties.title;
  const trust = trustFactsFor(graph, objectId);
  const outcome = outcomeOf(graph, objectId, releaseId);
  const trail = graph.trail.forObject(objectId, 500).reverse();       // oldest first: a trail reads forward
  const proof = graph.process.proof(objectId, "filtered");
  const receipts = graph.db.prepare(
    `SELECT r.capability, r.attempted, r.destination, r.outcome, r.at FROM action_receipts r JOIN objects o ON o.id = r.object_id
     WHERE o.parent_id = ? ORDER BY r.at`,
  ).all(objectId) as Array<{ capability: string; attempted: string; destination: string; outcome: string; at: number }>;

  // The delivery report's body, reused as the first section rather than restated.
  const report = deliveryReport(graph, objectId, releaseId);
  const reportBody = report.slice(report.indexOf("<body>") + 6, report.lastIndexOf("</body>"));

  const body = `
<header class="audit-head">
  <h1>${esc(title)}</h1>
  <p class="sub">Audit trail · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · from XENIUR's own records, without a model</p>
  <p class="trust">${esc(describeTrust(trust))}</p>
</header>

<section class="report">${reportBody}</section>

<h2>What the agent saw, decided, was authorised to do, and executed</h2>
<table class="trail">
  <thead><tr><th>Saw</th><th>Decided</th><th>Authorized</th><th>Executed</th><th>When</th></tr></thead>
  <tbody>${trail.length === 0 ? `<tr><td colspan=5 class=none>No model was asked anything about this.</td></tr>` : trail.map(trailRow).join("")}</tbody>
</table>
<p class=meta>A short row is a call that stopped early. The empty cells are empty because nothing happened, not because it was left out.</p>

<h2>Consequential actions and their receipts</h2>
<ul>${receipts.length === 0 ? `<li class=none>—</li>` : receipts.map((r) =>
  `<li><span class=cap>${esc(r.capability)}</span> ${esc(r.attempted)} → <span class=mono>${esc(r.destination)}</span> — <strong>${esc(r.outcome)}</strong> <span class=meta>${new Date(r.at).toISOString().slice(0, 16).replace("T", " ")}</span></li>`).join("")}</ul>

<h2>Process record</h2>
<p class=meta>${esc(proof.summary)}</p>
<ul class=process>${proof.events.map((e) =>
  `<li><span class=actor>${esc(e.actor)}</span> ${esc(e.label)}${e.durationMs > 0 ? ` <span class=meta>${Math.round(e.durationMs / 60_000)} min recorded</span>` : ""}</li>`).join("")}</ul>
<p class=meta>Recorded, not total. Root of the process record: <span class=mono>${esc(proof.rootHash)}</span></p>
`;

  const rootHash = sha256Hex(body);
  const publisher = graph.publishers.self().sign(rootHash);
  const manifest: AuditManifest = {
    format: "xeniur-audit/1", objectId, title, generatedAt: Date.now(), rootHash, publisher,
    counts: { trailRows: trail.length, processEvents: proof.events.length, receipts: receipts.length },
  };

  const html = `<!doctype html>
<html lang=en><head><meta charset=utf-8>
<title>${esc(title)} — audit trail</title>
<style>
  :root { color-scheme: light dark }
  body { max-width: 62rem; margin: 3rem auto; padding: 0 1.5rem; font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; color: #1b1b19; background: #fbfaf7 }
  @media (prefers-color-scheme: dark) { body { color: #eef0e9; background: #0b0d0c } .report { color: #eef0e9 } th, td, li, footer, .trail { border-color: #303630 } }
  h1 { font-size: 1.9rem; margin: 0 0 .2rem; font-weight: 600; letter-spacing: -.01em }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; opacity: .7; margin: 2.4rem 0 .6rem; font-weight: 600 }
  .sub, .meta { opacity: .7; font-size: .9em } .trust { margin: .4rem 0 0 }
  .report { margin: 2rem 0; padding: 0 0 1rem; border-bottom: 1px solid #e2ded4 } .report h1 { display: none } .report .sub { display: none }
  table.trail { width: 100%; border-collapse: collapse; font-size: .9em }
  .trail th, .trail td { text-align: left; vertical-align: top; padding: .5rem .6rem; border: 1px solid #e2ded4 }
  .trail td.empty { background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(128,128,128,.12) 6px 7px) }
  .mono, .cap { font: 12px ui-monospace, monospace } .cap { text-transform: uppercase; letter-spacing: .06em; opacity: .7 }
  ul { margin: 0; padding-left: 1.1rem } li { margin: .25rem 0 } li.none, td.none { list-style: none; opacity: .6 }
  .process .actor { display: inline-block; min-width: 4.5em; font: 12px ui-monospace, monospace; text-transform: uppercase; opacity: .7 }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2ded4; font-size: .85rem; opacity: .8 }
  footer pre { white-space: pre-wrap; word-break: break-all; font-size: 11px }
</style></head><body>
${body}
<footer>
  <p>Root hash of everything above: <span class=mono>${rootHash}</span><br>
  Signed by <strong>${esc(publisher.displayName)}</strong> (<span class=mono>${esc(publisher.publicKey)}</span>) with Ed25519.
  A reader who holds this public key can verify that the file is exactly what was written.</p>
  <pre id="xeniur-audit-manifest">${esc(canonicalJson(manifest))}</pre>
</footer>
</body></html>`;

  const leaks = findKeyShaped(html);
  if (leaks.length > 0) throw new KeyWouldLeak("an audit export", leaks);
  return { html, manifest };
}

function trailRow(r: TrailRow): string {
  const cell = (filled: boolean, inner: string) => filled ? `<td>${inner}</td>` : `<td class=empty aria-label="nothing recorded"></td>`;
  return `<tr aria-label="${esc(describeTrailRow(r))}">` +
    cell(!!r.saw, r.saw ? `<span class=mono>${esc(r.saw.digest.slice(0, 16))}</span><br>${r.saw.included} items · ${r.saw.excluded} excluded` : "") +
    cell(!!r.decided, r.decided ? `${esc(r.decided.kind.replaceAll("_", " "))}${r.decided.model ? `<br><span class=meta>${esc(r.decided.model)}</span>` : ""}` : "") +
    cell(!!r.authorized, r.authorized ? `<span class=mono>${esc(r.authorized.planDigest.slice(0, 16))}</span><br>${esc(r.authorized.level)}` : "") +
    cell(!!r.executed, r.executed ? `${esc(r.executed.outcome)}<br><span class=mono>${esc(r.executed.actionId.slice(0, 8))}</span>` : "") +
    `<td class=meta>${new Date(r.at).toISOString().slice(0, 16).replace("T", " ")}</td></tr>`;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
