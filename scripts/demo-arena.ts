/**
 * The Arena, end to end — two machines, one signed challenge, one sealed entry, one judgment.
 *
 *   npm run demo:arena
 *
 * An organizer publishes a ticketed challenge and exports it as a signed document. A
 * participant adopts it (quarantined as an unknown publisher), receives a ticket signed on
 * the organizer's channel — XENIUR sees no price — enters inside a Sealed Session that has a
 * 20-minute gap across a version change, and the verdict says *the record does not say* with
 * zero model events. The organizer opens judging after close, a judge sees one sheet and
 * records a signed assessment, and the results are the organizer's placings as written.
 *
 * Offline: two in-memory graphs stand for two machines; documents cross as JSON.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANNOT_ESTABLISH, RECORD_LIMITS, describeEnvelope, documentDigest, recordDensity, type ModeEnvelopeInput } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-arena-"));
const MIN = 60_000, DAY = 86_400_000;
let failures = 0, stepNo = 0;
const step = (t: string) => { stepNo += 1; console.log(`\n${String(stepNo).padStart(2, " ")}. ${t}`); };
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1;
};
const note = (t: string) => console.log(`       ${t}`);
/** Documents cross machines as JSON text, the way a file or a feed carries them. */
const across = <T,>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

async function main(): Promise<void> {
  console.log(`\nXENIUR — the Arena, end to end\nworkdir: ${workdir}\n${"=".repeat(64)}`);
  const organizer = ObjectGraph.open({ dbPath: join(workdir, "organizer.db"), blobDir: join(workdir, "o") });
  const participant = ObjectGraph.open({ dbPath: join(workdir, "participant.db"), blobDir: join(workdir, "p") });

  /* 1 */ step("The organizer publishes a ticketed challenge, signed");
  const challenge = organizer.challenges.create({
    title: "XENIUR Arena Algeria: Water", brief: "Cut the energy cost of a litre of desalinated or reused water, or find a leak before it is a loss.",
    rules: ["one entry per team", "a proposal and one image"], startsAt: Date.now() - DAY, endsAt: Date.now() + 2 * DAY,
    deliverable: { formRoles: ["doc.proposal"], description: "a proposal a plant operator in Oran would understand" },
    judging: { criteria: ["works on the stated problem", "the making is inspectable", "claims are supported"], by: "panel", scale: "one_to_five" },
    aiPolicy: "research_only", entry: "ticket", entryNote: "Tickets from the organizer; waivers for students",
  }, organizer.publishers.self());
  const doc = organizer.challenges.exportDocument(challenge.worldId)!;
  check("the document is signed over the rules digest", doc.signature.rootHash === challenge.signature.rootHash && doc.kind === "xeniur.challenge/1");

  /* 2 */ step("A participant adopts it — verified, quarantined as an unknown publisher");
  const here = participant.challenges.adoptDocument(across(doc))!;
  check("the challenge is a World on the participant's machine", participant.getWorld(here.worldId)?.kind === "challenge");
  check("the publisher is unknown here — three a day, until the person says otherwise", participant.publishers.trustOf(challenge.publisher.publicKey) === "unknown");
  check("adopting it again does nothing", participant.challenges.adoptDocument(across(doc)) === null);

  /* 3 */ step("Entry needs a ticket; the organizer signs one on their own channel");
  const me = participant.publishers.self().ref();
  const entryObject = participant.createObject({ worldId: here.worldId, semanticType: "proposal", title: "Leak finder for Oran's network" }).object.id;
  let refused = "";
  try { participant.challenges.enter(here.worldId, entryObject, me); } catch (e) { refused = (e as Error).message; }
  check("entering without a ticket is refused, in words", /needs an entry ticket/.test(refused), refused);
  const ticket = organizer.tickets.issue(challenge.worldId, me, challenge.rules.endsAt);
  check("the ticket carries no price, card or payment status", !/price|amount|DZD|card|paid/i.test(JSON.stringify(ticket)));
  participant.tickets.adopt(across(ticket));
  check("the ticket verifies against the challenge's publisher, by the challenge's signed identity", participant.tickets.held(here.worldId)!.valid);

  /* 4 */ step("The entry is made inside a Sealed Session — with a 20-minute gap across a version change");
  const t0 = Date.now() - 60 * MIN;
  const envelope: ModeEnvelopeInput = { durationMinutes: 120, restrictions: ["remote models off"], exitPolicy: "always", remoteModels: false, entryObjectId: entryObject, heartbeatSeconds: 60 };
  const sheet = describeEnvelope("sealed_session", envelope);
  note(sheet.lines.map((l) => `${l.label}: ${l.value}`).join("\n       "));
  const mode = participant.modes.start({ kind: "sealed_session", envelope, sheetDigest: sheet.digest, worldId: here.worldId });
  participant.db.prepare(`UPDATE modes SET started_at = ? WHERE id = ?`).run(t0, mode.id);
  participant.db.prepare(`UPDATE versions SET created_at = ? WHERE object_id = ?`).run(t0 - DAY, entryObject);
  for (let m = 1; m <= 10; m += 1) participant.seal.beat({ modeId: mode.id, focusObjectId: entryObject, versionId: null, at: t0 + m * MIN });
  const rep = participant.addRepresentation({ objectId: entryObject, modality: "text", format: "md", provenance: "human", blobHash: participant.putBlob(Buffer.from("# Leak finder\nAcoustic sensors on the trunk mains…"), "text/markdown", "md") });
  const v = participant.commitVersion({ objectId: entryObject, forms: [{ role: "doc.proposal", representationId: rep.id }] });
  participant.db.prepare(`UPDATE versions SET created_at = ? WHERE id = ?`).run(t0 + 20 * MIN, v.versionId);        // made in the dark
  participant.process.record({ objectId: entryObject, versionId: v.versionId, kind: "manual_edit", actor: "human", label: "wrote the proposal", tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 0, at: t0 + 20 * MIN });
  for (let m = 30; m <= 40; m += 1) participant.seal.beat({ modeId: mode.id, focusObjectId: entryObject, versionId: v.versionId, at: t0 + m * MIN });
  participant.modes.end(mode.id, "completed");
  participant.db.prepare(`UPDATE modes SET ended_at = ? WHERE id = ?`).run(t0 + 40 * MIN, mode.id);
  const facts = participant.seal.factsFor(entryObject)!;
  note(recordDensity(facts).sentence);
  check("one gap, across a version change, zero model events", facts.gaps.length === 1 && facts.gaps[0]!.versionChanged && facts.modelEvents === 0);

  /* 5 */ step("Entering spends the ticket; the verdict is the record does not say — never violates");
  const entry = participant.challenges.enter(here.worldId, entryObject, me);
  check("the ticket is used once", participant.tickets.held(here.worldId)!.usedAt !== null);
  check("verdict: insufficient_record, with the span named", entry.compliance.verdict === "insufficient_record" && /20 min with no heartbeat/.test(entry.compliance.because[0] ?? ""), entry.compliance.because[0]);
  check("density travels with the verdict, in words", entry.compliance.density?.sentence === recordDensity(facts).sentence);
  check("a second Object would need a second ticket", (() => { try { participant.challenges.enter(here.worldId, participant.createObject({ worldId: here.worldId, semanticType: "proposal", title: "Two" }).object.id, me); return false; } catch { return true; } })());

  /* 6 */ step("The challenge closes; the organizer opens judging and invites a judge");
  // For the pilot the organizer's machine holds the entries; the judge sits at it.
  const orgEntryObject = organizer.createObject({ worldId: challenge.worldId, semanticType: "proposal", title: "Leak finder for Oran's network" }).object.id;
  const orgRep = organizer.addRepresentation({ objectId: orgEntryObject, modality: "text", format: "md", provenance: "human", blobHash: organizer.putBlob(Buffer.from("# Leak finder"), "text/markdown", "md") });
  organizer.commitVersion({ objectId: orgEntryObject, forms: [{ role: "doc.proposal", representationId: orgRep.id }] });
  organizer.process.record({ objectId: orgEntryObject, versionId: null, kind: "manual_edit", actor: "human", label: "wrote", tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 0 });
  const orgEntry = organizer.challenges.enter(challenge.worldId, orgEntryObject, me);
  const closedAt = Date.now() - 1;
  organizer.db.prepare(`UPDATE challenges SET ends_at = ?, rules = json_set(rules, '$.endsAt', ?) WHERE world_id = ?`).run(closedAt, closedAt, challenge.worldId);
  organizer.judging.open(challenge.worldId);
  organizer.judging.invite(challenge.worldId, organizer.publishers.self().ref());
  check("judging is open and the judge is trusted", organizer.judging.status(challenge.worldId).judgingOpenedAt !== null && organizer.judging.isJudge(challenge.worldId, organizer.publishers.self().publicKey));

  /* 7 */ step("The judge sees one sheet and records a signed assessment");
  const judgeSheet = organizer.judging.sheetFor(challenge.worldId, orgEntry.id)!;
  check("the sheet names the entry by arrival order, not a rank", judgeSheet.entryNumber === 1 && judgeSheet.entryCount === 1);
  check("the three-row table of limits is on it", RECORD_LIMITS.length === 3 && CANNOT_ESTABLISH.includes("not independently verified"));
  note(RECORD_LIMITS.map((r) => `${r.what} — ${r.goesAsFar}`).join("\n       "));
  const assessment = organizer.judging.assess(challenge.worldId, orgEntry.id, [
    { criterion: "works on the stated problem", mark: 4, note: "a real network, a real sensor" },
    { criterion: "the making is inspectable", mark: null, note: "no seal covered this copy; I did not mark it" },
    { criterion: "claims are supported", mark: 3, note: "" },
  ], "Strong on the problem; the record is thin on this copy.");
  check("the assessment is the judge's signed document", assessment.kind === "xeniur.judging/1" && assessment.signature.rootHash === documentDigest(assessment.body));
  check("it records what the judge saw", assessment.body.inspected.verdict === orgEntry.compliance.verdict);

  /* 8 */ step("Results: the organizer's placings, as written, signed — never a computed rank");
  const results = organizer.judging.publishResults(challenge.worldId, [
    { place: "First", entryId: orgEntry.id, objectId: orgEntryObject, reason: "The only entry a plant operator in Oran could use on Monday." },
  ], "One entry, one placing, as the panel discussed it.");
  check("the results verify and carry the finalist's process record and verdict", results.signature.rootHash === documentDigest(results.body) && results.body.finalists[0]!.verdict === orgEntry.compliance.verdict);
  check("no rank, score or average anywhere", !/"rank"|"score"|"average"|"total"/.test(JSON.stringify(results.body)));
  // The results cross to the participant's machine and verify there, by the challenge's signed identity.
  const adopted = participant.judging.adoptResults(across(results));
  check("the participant's copy holds the same signed results", adopted.publishedAt === results.body.publishedAt && participant.judging.results(here.worldId)!.signature.signature === results.signature.signature);

  /* 9 */ step("No model was called on either machine");
  const trail = (g: ObjectGraph) => (g.db.prepare(`SELECT COUNT(*) c FROM agent_trail`).get() as { c: number }).c;
  check("both agent trails are empty", trail(organizer) === 0 && trail(participant) === 0);

  organizer.close(); participant.close();
  console.log(`\n${"=".repeat(64)}\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
