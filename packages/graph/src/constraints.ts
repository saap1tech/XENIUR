import type { Constraint, ConstraintRecord, ConstraintValue, ObjectState } from "@xeniur/core";
import { ConstraintSchema, parseConstraintValue } from "@xeniur/core";
import type { Db } from "./db.js";
import { json } from "./db.js";

interface ConstraintGraph {
  currentState(objectId: string): ObjectState | null;
  setProperties(objectId: string, patch: { settings: Record<string, unknown> }, label?: string): ObjectState;
}

interface ConstraintRow { object_id: string; kind: string; unit: string | null; spec: string; applies_to: string; }

export class ConstraintStore {
  constructor(private readonly db: Db, private readonly graph: ConstraintGraph) {}

  define(objectId: string, definitionInput: Constraint, appliesTo: string, initialValue: unknown): ConstraintRecord {
    const definition = ConstraintSchema.parse(definitionInput);
    const value = parseConstraintValue(definition, initialValue);
    const unit = "unit" in definition ? definition.unit : null;
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO constraints (object_id, kind, unit, spec, applies_to) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(object_id) DO UPDATE SET kind = excluded.kind, unit = excluded.unit,
           spec = excluded.spec, applies_to = excluded.applies_to`,
      ).run(objectId, definition.kind, unit, json.stringify(definition), appliesTo);
      const current = this.graph.currentState(objectId);
      if (!current) throw new Error(`unknown constraint object: ${objectId}`);
      this.graph.setProperties(objectId, {
        settings: { ...current.properties.settings, constraintValue: value },
      }, "changed constraint");
    })();
    return this.get(objectId)!;
  }

  setValue(objectId: string, input: unknown): ConstraintRecord {
    const record = this.get(objectId);
    if (!record) throw new Error(`unknown constraint: ${objectId}`);
    const value = parseConstraintValue(record.definition, input);
    const current = this.graph.currentState(objectId)!;
    this.graph.setProperties(objectId, {
      settings: { ...current.properties.settings, constraintValue: value },
    }, "changed constraint");
    return this.get(objectId)!;
  }

  get(objectId: string): ConstraintRecord | null {
    const row = this.db.prepare(`SELECT * FROM constraints WHERE object_id = ?`).get(objectId) as ConstraintRow | undefined;
    if (!row) return null;
    const state = this.graph.currentState(objectId);
    if (!state) return null;
    const definition = ConstraintSchema.parse(json.parse(row.spec, {}));
    const value = parseConstraintValue(definition, state.properties.settings["constraintValue"]);
    const version = this.db.prepare(`SELECT created_at FROM versions WHERE id = ?`).get(state.versionId) as
      { created_at: number } | undefined;
    return {
      objectId, definition, value, appliesTo: row.applies_to,
      createdAt: state.object.createdAt, updatedAt: version?.created_at ?? state.object.createdAt,
    };
  }

  list(worldId?: string): ConstraintRecord[] {
    return (this.db.prepare(`SELECT object_id FROM constraints ORDER BY rowid`).all() as Array<{ object_id: string }>)
      .map((row) => this.get(row.object_id)).filter((item): item is ConstraintRecord => item !== null)
      .filter((item) => !worldId || this.graph.currentState(item.objectId)?.object.worldId === worldId);
  }
}
