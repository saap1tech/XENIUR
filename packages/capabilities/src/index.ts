import {
  ActionPlanSchema, CapabilityManifestSchema, rankOf, sha256Hex, specOf,
  type ActionPlan, type CapabilityManifest, type SceneComponentName, type SemanticTrait,
  type VisualPrimitive,
} from "@xeniur/core";

const COMPONENT_FOR: Readonly<Record<VisualPrimitive, SceneComponentName>> = {
  map: "SchematicMap", calendar: "Calendar", people: "PeopleChips", cost: "RangeMeter",
  quantity: "Stepper", priority: "PriorityBalance", timeline: "Timeline",
  relationships: "ObjectOrbit", choices: "ChoiceCards", constraints: "ConstraintStrip",
  evidence: "EvidenceMeter", review: "ReviewSheet",
};

export interface CapabilitySubject {
  id: string;
  traits: readonly SemanticTrait[];
}

export interface CompiledCapability {
  manifest: CapabilityManifest;
  manifestDigest: string;
  components: Readonly<Record<string, SceneComponentName>>;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};

/** Registry for declarative capability programs. Adapters are host-owned and allowlisted. */
export class CapabilityRegistry {
  readonly #trustedAdapters: ReadonlySet<string>;
  readonly #items = new Map<string, CompiledCapability>();

  constructor(trustedAdapters: readonly string[]) {
    this.#trustedAdapters = new Set(trustedAdapters);
  }

  register(input: unknown): CompiledCapability {
    const manifest = CapabilityManifestSchema.parse(input);
    if (!this.#trustedAdapters.has(manifest.execution.adapter)) {
      throw new Error(`Capability adapter is not trusted: ${manifest.execution.adapter}`);
    }
    const tool = specOf(manifest.execution.operation);
    if (tool.external && !manifest.traits.includes("external")) {
      throw new Error("An external operation must declare the external trait.");
    }
    if (rankOf(manifest.permission) < rankOf(tool.permission)) {
      throw new Error(`Capability permission cannot be lower than ${tool.permission}.`);
    }
    if (manifest.traits.includes("consequential") && rankOf(manifest.permission) < rankOf("COMMUNICATE")) {
      throw new Error("A consequential capability must require COMMUNICATE or higher.");
    }
    const components = Object.fromEntries(Object.entries(manifest.visualSemantics)
      .map(([meaning, primitive]) => [meaning, COMPONENT_FOR[primitive as VisualPrimitive]]));
    const compiled = { manifest, components, manifestDigest: sha256Hex(canonical(manifest)) };
    this.#items.set(manifest.capability, compiled);
    return compiled;
  }

  get(capability: string): CompiledCapability | null {
    return this.#items.get(capability) ?? null;
  }

  plan(capability: string, subjects: Record<string, CapabilitySubject>, values: Record<string, unknown>): ActionPlan {
    const compiled = this.#items.get(capability);
    if (!compiled) throw new Error(`Capability is not registered: ${capability}`);
    for (const accepted of compiled.manifest.accepts) {
      const subject = subjects[accepted.name];
      if (!subject && !accepted.optional) throw new Error(`Capability needs ${accepted.name}.`);
      if (subject && accepted.traits.some((trait) => !subject.traits.includes(trait))) {
        throw new Error(`${accepted.name} does not satisfy the required traits.`);
      }
    }
    for (const [name, descriptor] of Object.entries(compiled.manifest.inputSchema)) {
      const value = values[name];
      if (value === undefined && descriptor.required) throw new Error(`Capability needs ${name}.`);
      if (value === undefined) continue;
      if (descriptor.type === "string" && typeof value !== "string") throw new Error(`${name} must be text.`);
      if (descriptor.type === "number" && (typeof value !== "number" || !Number.isFinite(value) ||
          (descriptor.min !== undefined && value < descriptor.min) || (descriptor.max !== undefined && value > descriptor.max))) {
        throw new Error(`${name} is outside the accepted numeric range.`);
      }
      if (descriptor.type === "boolean" && typeof value !== "boolean") throw new Error(`${name} must be true or false.`);
      if (descriptor.type === "enum" && (typeof value !== "string" || !descriptor.values.includes(value))) {
        throw new Error(`${name} is not an accepted option.`);
      }
      if (descriptor.type === "object_ref" && typeof value !== "string") throw new Error(`${name} must name an Object.`);
    }
    return ActionPlanSchema.parse({
      intent: compiled.manifest.title,
      objects: Object.values(subjects).map((subject) => subject.id),
      tool: compiled.manifest.execution.operation,
      args: { capability, ...values },
      confirmation: rankOf(compiled.manifest.permission) >= rankOf("COMMUNICATE"),
      rationale: compiled.manifest.description,
    });
  }
}

export const HOTEL_RESERVE_EXAMPLE = {
  format: "xeniur-capability/1",
  capability: "hotel.reserve",
  title: "Reserve hotel",
  description: "Reserve one selected stay for recorded dates and people.",
  accepts: [
    { name: "Hotel", traits: ["locatable", "priced", "temporal", "bookable"] },
    { name: "Dates", traits: ["temporal"] },
    { name: "People", traits: ["personLike"] },
    { name: "PaymentMethod", traits: ["external"] },
  ],
  traits: ["external", "priced", "consequential"],
  permission: "PURCHASE",
  inputSchema: { quotedPrice: { type: "number", required: true, min: 0, unit: "USD" } },
  visualSemantics: { where: "map", when: "calendar", who: "people", cost: "review" },
  execution: { adapter: "xeniur.hands", operation: "browser.submit", version: "1" },
  produces: { semanticType: "reservation_receipt", traits: ["external", "consequential", "deliverable", "versioned"] },
} as const;
