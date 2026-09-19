import {
  ActionReceiptRecordSchema, planDigest, type ActionReceiptRecord, type ActionRecord,
  type ObjectState, type Receipt,
} from "@xeniur/core";
import type { Db } from "./db.js";
import { json } from "./db.js";

interface ReceiptGraph {
  getAction(id: string): ActionRecord | null;
  currentState(id: string): ObjectState | null;
  createObject(input: { worldId: string; semanticType: string; title: string; properties?: Partial<ObjectState["properties"]>; parentId?: string | null }): ObjectState;
}

interface ReceiptRow {
  object_id: string; action_id: string; capability: string; attempted: string; plan_digest: string;
  account_session_id: string | null; destination: string; data_sent: string; quoted_price: string | null;
  actual_price: string; provider_response: string | null; at: number; outcome: ActionReceiptRecord["outcome"];
}

const fromRow = (row: ReceiptRow, worldId: string): ActionReceiptRecord => ActionReceiptRecordSchema.parse({
  objectId: row.object_id, actionId: row.action_id, worldId, capability: row.capability,
  attempted: row.attempted, planDigest: row.plan_digest, accountSessionId: row.account_session_id,
  destination: row.destination, dataSent: json.parse(row.data_sent, []),
  quotedPrice: row.quoted_price ? json.parse(row.quoted_price, null) : null,
  actualPrice: json.parse(row.actual_price, {}),
  providerResponse: row.provider_response ? json.parse(row.provider_response, null) : null,
  at: row.at, outcome: row.outcome,
});

/** Turns a transient external result into an immutable, inspectable Living Object. */
export class ActionReceiptStore {
  constructor(private readonly db: Db, private readonly graph: ReceiptGraph) {}

  record(actionId: string, receipt: Receipt): ActionReceiptRecord {
    return this.db.transaction(() => this.#record(actionId, receipt))();
  }

  #record(actionId: string, receipt: Receipt): ActionReceiptRecord {
    const existing = this.getByAction(actionId);
    if (existing) return existing;
    const action = this.graph.getAction(actionId);
    if (!action) throw new Error(`Cannot receipt an unknown action: ${actionId}`);
    const destination = receipt.destination ?? receipt.url ??
      (typeof action.plan.args["domain"] === "string" ? action.plan.args["domain"] : action.tool);
    // When an executor did not return the broker digest, hash the exact ActionPlan
    // persisted before execution. Never reconstruct a lookalike from selected fields.
    const digest = receipt.planDigest ?? planDigest(action.plan);
    const outcome: ActionReceiptRecord["outcome"] = action.status === "completed" ? "succeeded"
      : action.status === "failed" ? "failed" : action.status === "refused" ? "refused" : "unknown";
    const capability = typeof action.plan.args["capability"] === "string"
      ? action.plan.args["capability"] : action.tool;
    const receiptFacts = {
      actionId,
      capability,
      attempted: receipt.attempted || action.intent,
      planDigest: digest,
      accountSessionId: receipt.sessionGrantId,
      destination,
      dataSent: receipt.dataSent,
      quotedPrice: receipt.quotedPrice,
      actualPrice: receipt.actualPrice ?? action.cost,
      providerResponse: receipt.providerResponse ?? {
        status: receipt.outcome, reference: null, digest: receipt.domDigest,
      },
      at: receipt.at,
      outcome,
    };
    const object = this.graph.createObject({
      worldId: action.worldId,
      semanticType: "action_receipt",
      title: `Receipt: ${receipt.attempted || action.intent}`,
      parentId: action.plan.objects[0] && this.graph.currentState(action.plan.objects[0]) ? action.plan.objects[0] : null,
      properties: {
        traits: ["consequential", "deliverable", "external", "versioned"],
        tags: ["action-receipt", outcome],
        // The typed table supports queries; this snapshot makes the Object self-describing
        // through normal version/property inspection and export paths as well.
        settings: { actionReceipt: receiptFacts },
      },
    });
    const record = ActionReceiptRecordSchema.parse({
      objectId: object.object.id, worldId: action.worldId, ...receiptFacts,
    });
    this.db.prepare(
      `INSERT INTO action_receipts (object_id, action_id, capability, attempted, plan_digest,
       account_session_id, destination, data_sent, quoted_price, actual_price,
       provider_response, at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.objectId, record.actionId, record.capability, record.attempted, record.planDigest,
      record.accountSessionId, record.destination, json.stringify(record.dataSent),
      record.quotedPrice ? json.stringify(record.quotedPrice) : null, json.stringify(record.actualPrice),
      record.providerResponse ? json.stringify(record.providerResponse) : null, record.at, record.outcome);
    return record;
  }

  getByAction(actionId: string): ActionReceiptRecord | null {
    const row = this.db.prepare("SELECT * FROM action_receipts WHERE action_id = ?").get(actionId) as ReceiptRow | undefined;
    if (!row) return null;
    const action = this.graph.getAction(actionId);
    return action ? fromRow(row, action.worldId) : null;
  }

  get(objectId: string): ActionReceiptRecord | null {
    const row = this.db.prepare("SELECT * FROM action_receipts WHERE object_id = ?").get(objectId) as ReceiptRow | undefined;
    if (!row) return null;
    const action = this.graph.getAction(row.action_id);
    return action ? fromRow(row, action.worldId) : null;
  }
}
