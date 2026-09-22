/**
 * The browser, end to end — an account, a capture, a comparison, a grant, an action.
 *
 *   npm run demo:browser
 *
 * Browsing is not disclosing, saving is not accepting, a click is not a success. This runs at
 * the graph level with a snapshot standing in for the visible tab, so every rule can be shown
 * without Electron: what a capture carries, what reaches a model and what does not, what a
 * changed requirement does to a comparison, what a grant refuses, and the four states an
 * attempt can honestly be in.
 *
 * Offline: no model is called and nothing leaves the machine; checks prove both.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrantRefused, sha256Hex } from "@xeniur/core";
import { MockRouteAdapter, ObjectGraph } from "@xeniur/graph";
import { SensemakingStore, extractCandidates } from "@xeniur/sensemaking";
import { compileContext, proposalsFor } from "@xeniur/grammar";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-browser-"));
const HOUR = 3_600_000;
let failures = 0, stepNo = 0;
const step = (t: string) => { stepNo += 1; console.log(`\n${String(stepNo).padStart(2, " ")}. ${t}`); };
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1;
};
const note = (t: string) => console.log(`       ${t}`);

/** What the visible, signed-in tab was showing. In the app this comes from the view itself. */
const SNAPSHOT = {
  tabId: "tab-1", profileLabel: "Supplier portal",
  url: "https://supplier.example/spec",
  title: "Seam tape, technical data",
  selectionText: "A 2024 trial found that 63% of taped seams held through two winters of cold cycling at 12 mm tape width.",
  pageText: "Seam tape, technical data. A 2024 trial found that 63% of taped seams held through two winters of cold cycling at 12 mm tape width. Welded seams were tested in a freezer at a fixed temperature.",
};

async function main(): Promise<void> {
  console.log(`\nXENIUR — the browser, end to end\nworkdir: ${workdir}\n${"=".repeat(64)}`);
  const graph = ObjectGraph.open({ dbPath: join(workdir, "x.db"), blobDir: join(workdir, "blobs") });
  const sense = new SensemakingStore(graph);
  const worldId = graph.createWorld({ title: "Cold-weather shell", emoji: "◒" }).id;
  const goal = graph.goals.create(worldId, "Choose a seam construction the client will accept");

  /* 1 */ step("An account of the person's own, and a tab that belongs to their work");
  const profileId = "p-work";
  graph.db.prepare(`INSERT INTO browser_profiles (id, label, kind, partition, created_at, last_used_at) VALUES (?, ?, 'signed_in', ?, ?, NULL)`)
    .run(profileId, "Supplier portal", `persist:web:profile:${profileId}`, Date.now());
  graph.db.prepare(`INSERT INTO browser_tabs (id, profile_id, world_id, goal_id, step_id, url, title, position, opened_at, closed_at) VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, NULL)`)
    .run(SNAPSHOT.tabId, profileId, worldId, goal.id, SNAPSHOT.url, SNAPSHOT.title, Date.now());
  const partition = (graph.db.prepare(`SELECT partition FROM browser_profiles WHERE id = ?`).get(profileId) as { partition: string }).partition;
  check("a signed-in account persists, and keeps the prefix the IPC guard refuses", partition.includes("persist:web"));

  /* 2 */ step("Save to project: the copy, where it came from, and what may be done with it");
  const source = sense.recordSource({
    worldId, kind: "clip", title: SNAPSHOT.title, text: SNAPSHOT.selectionText, hash: sha256Hex(SNAPSHOT.selectionText),
    url: SNAPSHOT.url, rights: "unknown",
    metadata: { capturedFrom: "visible_session", tabId: SNAPSHOT.tabId, account: SNAPSHOT.profileLabel, capturedAt: Date.now() },
  });
  const version = sense.latestVersionOf(source.id)!;
  check("the stored copy is the words that were on screen", sense.textOfVersion(version.id) === SNAPSHOT.selectionText);
  note(`from ${SNAPSHOT.url}, in the session signed in as ${SNAPSHOT.profileLabel}`);
  check("rights are unknown by default — being able to read is not a licence", (graph.db.prepare(`SELECT rights FROM source_versions WHERE id = ?`).get(version.id) as { rights: string }).rights === "unknown");

  /* 3 */ step("Saving is not proposing, and proposing is not accepting");
  const proposed = sense.propose(worldId, version.id, extractCandidates(SNAPSHOT.selectionText), "heuristic/1");
  check("nothing became knowledge on saving", sense.listAtoms(worldId).length === 0 && proposed.length > 0, `${proposed.length} proposed`);
  const claim = sense.accept(proposed[0]!.id)!;
  check("accepting one is a separate act that makes exactly one atom", sense.listAtoms(worldId).length === 1);

  /* 4 */ step("Browsing is not disclosing: captured material needs its own grant to leave");
  const material = {
    focus: { id: source.id, title: SNAPSHOT.title, semanticType: "source", formRoles: [], summary: "" },
    decisions: [], constraints: [], changes: [],
    passages: [{ sourceVersionId: version.id, sourceTitle: SNAPSHOT.title, text: SNAPSHOT.selectionText,
      rights: "unknown" as const, citedBy: null, supportReviewed: false, relatedToFocus: true, aiAllowed: true, needsDisclosureGrant: true }],
  };
  const policy = { destination: "remote" as const, maxTokens: 6000, includeDecisions: true, includePassages: true, includeConstraints: true, includeChanges: true, onlyReviewedSupport: false, disclosureApproved: [] as string[] };
  const refusedContext = compileContext(material, policy);
  note(refusedContext.excluded.map((e) => `${e.label}: ${e.why}`).join(" · "));
  check("without a disclosure grant it does not leave for a remote model", refusedContext.excluded.some((e) => e.why === "no_disclosure_grant"));
  const disclosure = graph.grants.issue({ kind: "model_disclosure", worldId, goalId: goal.id, dataVersionIds: [version.id],
    modelDestinations: ["remote"], expiresAt: Date.now() + HOUR, because: "compare this passage against the requirement" });
  const allowed = compileContext(material, { ...policy, disclosureApproved: [version.id] });
  check("with one, it does — and a local model was never a disclosure", allowed.included.some((i) => i.kind === "passage")
    && compileContext(material, { ...policy, destination: "local" }).included.some((i) => i.kind === "passage"));
  void disclosure;

  /* 5 */ step("Passage → requirement: three readings, and the gesture accepts nothing");
  const requirement = graph.createObject({ worldId, semanticType: "constraint", title: "Client requirement" }).object.id;
  const rq = (t: string) => graph.addRepresentation({ objectId: requirement, modality: "text", format: "md", provenance: "human", blobHash: graph.putBlob(Buffer.from(t), "text/markdown", "md") });
  graph.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rq("taped seams throughout the cold-weather range").id }] });
  const proposals = proposalsFor(
    { id: claim.objectId, title: claim.text, semanticType: "source" },
    { id: requirement, title: "Client requirement", kind: "requirement" },
  );
  note(proposals.map((p) => p.label).join(" · "));
  check("three readings, every one a link — nothing accepted, nothing sent, nothing executed",
    proposals.map((p) => p.label).join("|") === "Use as evidence|Compare with requirement|Save as reference" && proposals.every((p) => p.outcome.kind === "semantic_link"));

  const compare = proposals[1]!.outcome as { fromObjectId: string; toObjectId: string; relation: "review_on_change"; note: string };
  graph.decisions.link({ fromObjectId: compare.fromObjectId, toObjectId: compare.toObjectId, relation: compare.relation, note: compare.note });
  check("the comparison is pinned to the requirement's version and quiet until it moves", graph.decisions.reviewQueue(worldId).length === 0);

  /* 6 */ step("The requirement changes: the comparison is marked for review, not rewritten");
  graph.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rq("welded seams acceptable below 40 units").id }] });
  const queue = graph.decisions.reviewQueue(worldId);
  note(queue.map((q) => q.because).join(" · "));
  check("the comparison is in the review queue", queue.some((q) => q.objectId === claim.objectId));
  check("closing the tab changed nothing: the meaning is in the graph", graph.decisions.linksTo(claim.objectId)[0]!.note.includes("was compared against"));

  /* 7 */ step("An action is drafted, described and approved as an exact plan");
  const adapter = new MockRouteAdapter({ execute: { state: "uncertain", reference: "ord-9", responseDigest: null, detail: "the connection closed before it answered" },
    status: { state: "confirmed", detail: "the endpoint has it as received" } });
  graph.delegated.register(adapter);
  const draft = await graph.delegated.draft({ worldId, goalId: goal.id, adapterId: adapter.id, request: {
    route: "service_api", actionClass: "api_post", tabId: null, elementRef: null, endpointId: "receiver",
    fields: { order: "120 m taped tape, 12 mm" }, items: [{ title: "Seam specification", objectId: claim.objectId, versionId: version.id, digest: null }],
    amount: 240, currency: "USD",
  } });
  note(`${draft.description.effect} · ${draft.description.verification}`);
  check("the description names fields and their sizes, never their values",
    draft.description.fields.every((f) => typeof f.chars === "number") && !JSON.stringify(draft.description).includes("120 m taped tape"),
    draft.description.fields.map((f) => `${f.name}: ${f.chars}`).join(" · "));
  check("nothing was sent by describing it", adapter.executed.length === 0);

  const grant = graph.grants.issue({ kind: "action", route: "service_api", worldId, goalId: goal.id, accountLabel: "My receiver",
    accountVerifiedBy: "person", actionClasses: ["api_post"], reviewDigest: draft.reviewDigest, oneUse: true,
    limits: { maxActions: 1, maxAmount: 240, currency: "USD" }, expiresAt: Date.now() + HOUR, because: draft.description.effect });
  graph.delegated.approve(draft.id, grant.id);

  /* 8 */ step("A grant refuses what it does not cover");
  const wrong = graph.grants.issue({ kind: "action", route: "service_api", worldId, actionClasses: ["api_post"],
    reviewDigest: "b".repeat(64), expiresAt: Date.now() + HOUR, because: "a different plan" });
  let refused = "";
  try { graph.delegated.approve(draft.id, wrong.id); } catch (e) { refused = (e as GrantRefused).message; }
  check("a grant approved for another plan is refused, in words", /plan changed after you approved it/.test(refused), refused);
  let overLimit = "";
  try { graph.grants.assert(grant.id, { kind: "action", actionClass: "api_post", digest: draft.reviewDigest, amount: 900 }); }
  catch (e) { overLimit = (e as GrantRefused).message; }
  check("an amount past the limit is refused", /limit/.test(overLimit), overLimit);

  /* 9 */ step("A click is not a success: uncertain, then a check, then confirmed");
  const attempt = await graph.delegated.dispatch(draft.id);
  note(`${attempt.state} — ${attempt.detail}`);
  check("an answer that establishes nothing leaves it uncertain", attempt.state === "uncertain");
  let second = "";
  try { await graph.delegated.dispatch(draft.id); } catch (e) { second = (e as Error).message; }
  check("a second send is refused until the first is answered", /check its status before sending again/.test(second));
  check("the route was called once", adapter.executed.length === 1);
  const checked = await graph.delegated.checkStatus(attempt.id);
  check("the check is a row, and it confirms", checked.result === "confirmed" && graph.delegated.attempt(attempt.id)!.state === "confirmed");
  const outcomes = (graph.db.prepare(`SELECT outcome FROM action_receipts ORDER BY at`).all() as Array<{ outcome: string }>).map((r) => r.outcome);
  check("the receipts keep what was known, in order", outcomes.join(",") === "unknown,succeeded", outcomes.join(","));
  const receipts = graph.db.prepare(`SELECT data_sent FROM action_receipts`).all() as Array<{ data_sent: string }>;
  check("no receipt carries a field's value", receipts.every((r) => !r.data_sent.includes("120 m taped tape") && r.data_sent.includes("order")));

  /* 10 */ step("Everything the person allowed is revoked when XENIUR restarts");
  check("grants were active", graph.grants.active(worldId).length > 0);
  const revoked = graph.grants.revokeAll("XENIUR restarted");
  check(`${revoked} revoked, none left`, graph.grants.active(worldId).length === 0);
  const trail = (graph.db.prepare(`SELECT COUNT(*) c FROM agent_trail`).get() as { c: number }).c;
  check("no model was called anywhere", trail === 0);

  graph.close();
  console.log(`\n${"=".repeat(64)}\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
