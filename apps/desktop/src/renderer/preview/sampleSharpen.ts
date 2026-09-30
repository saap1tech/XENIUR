import type { SharpenSession, WorkState, XeniurBridge } from "@xeniur/core";
import { SharpenAnswerSchema } from "@xeniur/core";
import { sampleDecision, sampleGoal, sampleSnapshot, sampleStates, sampleRepresentations } from "./sampleWorld.js";

/** Localhost preview data only. Production work is assessed and saved by WorkStateStore. */
export function sampleWorkStateBridge(): XeniurBridge["workState"] {
  let latest: SharpenSession | null = null;
  const signals: WorkState["signals"] = [
    { id: "preview-change", kind: "changed_basis", objectId: sampleDecision.objectId, title: sampleDecision.question, fact: "This decision is marked for review after a client requirement changed.", priority: 0, subjectKey: "review_flag", lastCheckedAt: null },
    { id: "preview-assumption", kind: "assumption", objectId: sampleDecision.objectId, title: sampleDecision.question, fact: "Assumption to check: The 63% share holds outside cold climates.", priority: 3, subjectKey: "assumption:preview", lastCheckedAt: null },
  ];
  return {
    assess: async () => ({ goalId: sampleGoal.id, worldId: sampleSnapshot.world.id, outcome: sampleGoal.outcome, assessedAt: Date.now(), signals, latestSession: latest }),
    session: async (id) => latest?.id === id ? structuredClone(latest) : null,
    start: async (_goalId, objectId, signalId) => {
      const signal = signals.find((s) => s.id === signalId);
      const target = sampleStates.find((s) => s.object.id === (objectId ?? signal?.objectId ?? sampleDecision.objectId))!;
      const isDecision = target.object.id === sampleDecision.objectId;
      const record = isDecision ? `${sampleDecision.rationale}\nChosen: Taped seams\nOther option: Welded seams — cheaper at volume\nAssumption: The 63% share holds outside cold climates.` : `Goal: ${sampleGoal.outcome}\nWork: ${target.properties.title}\nCurrent forms: ${target.forms.map((f) => f.role).join(", ")}`;
      const moves: SharpenSession["moves"] = [
        { id: crypto.randomUUID(), kind: "recall", prompt: isDecision ? "Why did you choose taped seams? Recall the reasons before opening the record." : `What is “${target.properties.title}” meant to achieve? Explain it in your own words.`, recorded: record, changes: isDecision ? ["The client requirement changed after the comparison was recorded."] : [], effects: ["reflect"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null },
        { id: crypto.randomUUID(), kind: "distinguish", prompt: "What has reviewed support, and what is still an assumption?", recorded: record, changes: [], effects: ["reflect"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null },
        { id: crypto.randomUUID(), kind: "challenge", prompt: `What evidence would make you reconsider “${target.properties.title}”?`, recorded: record, changes: [], effects: ["reflect", "needs_review", "source"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null },
        { id: crypto.randomUUID(), kind: "apply", prompt: signal?.kind === "assumption" ? `How did you check this assumption? ${signal.fact}` : "What new case, source, or requirement would you test against the work?", recorded: record, changes: [], effects: signal?.kind === "assumption" ? ["reflect", "test", "checked"] : ["reflect", "test"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null },
      ];
      if (isDecision) moves.push({ id: crypto.randomUUID(), kind: "decide", prompt: "Keep your choice or reopen it? Include your reason.", recorded: record, changes: [], effects: ["keep", "needs_review"], answer: null, effect: null, reflectionObjectId: null, answeredAt: null });
      latest = { id: crypto.randomUUID(), goalId: sampleGoal.id, worldId: sampleGoal.worldId, objectId: target.object.id, objectVersionId: target.versionId, title: target.properties.title,
        subjectKey: signal?.subjectKey ?? "recall", basisDigest: "preview-only", fact: signal?.fact ?? "A short check of your work.", moves, createdAt: Date.now() };
      return structuredClone(latest);
    },
    answer: async (input) => {
      const a = SharpenAnswerSchema.parse(input);
      if (!latest || latest.id !== a.sessionId) throw new Error("This preview session changed.");
      const m = latest.moves.find((m) => m.id === a.moveId);
      if (!m || !m.effects.includes(a.effect)) throw new Error("Choose an available action.");
      const id = crypto.randomUUID(), repId = crypto.randomUUID(), versionId = crypto.randomUUID();
      const title = `${m.kind} · ${latest.title}`;
      m.answer = a.answer; m.effect = a.effect; m.answeredAt = Date.now(); m.reflectionObjectId = id;
      sampleStates.push({ object: { id, worldId: sampleGoal.worldId, parentId: null, currentVersionId: versionId, currentBranchId: null, createdAt: Date.now(), archivedAt: null }, versionId, seq: 1, branchId: null, branchName: "main",
        properties: { title, semanticType: "note", traits: [], tags: ["sharpen"], dimensions: null, units: null, settings: {} }, forms: [{ role: "doc.primary", representationId: repId }], recipeId: null });
      sampleRepresentations.push({ id: repId, objectId: id, modality: "text", format: "md", blobHash: null, producedByActionId: null, provenance: "human", provider: null, model: null, toolVersion: null, generationParams: { preview: a.answer }, createdAt: Date.now() });
      if (a.effect === "test" || a.effect === "source" || a.effect === "needs_review") sampleGoal.nextActions.push({ id: crypto.randomUUID(), text: `${a.effect === "test" ? "Test" : a.effect === "source" ? "Find another source" : "Review"}: ${a.answer}`, objectId: id, tool: null, origin: "person", doneAt: null });
      return structuredClone(latest);
    },
  };
}
