import { describe, it, expect } from "vitest";
import { compileContext, type ContextMaterial, type ContextPolicy } from "./context.js";

const OBJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DEC2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SV1 = "11111111-1111-4111-8111-111111111111";
const SV2 = "22222222-2222-4222-8222-222222222222";
const CON = "33333333-3333-4333-8333-333333333333";

const material = (over: Partial<ContextMaterial> = {}): ContextMaterial => ({
  focus: { id: OBJ, title: "Launch film hero prop", semanticType: "prop", formRoles: ["source.primary", "print.stl"], summary: "" },
  decisions: [{
    objectId: DEC, question: "How should the prop be finished?", chosenOption: "Matte throughout",
    rationale: "The brief is explicit and the film is lit hard.", state: "accepted", acceptedVersionId: null,
    assumptions: [
      { text: "The film is shot under hard studio light", reviewTrigger: "the shoot moves outdoors", kind: "assumption" },
      { text: "Matte can look flat under overcast light", reviewTrigger: "", kind: "steelman" },
    ],
    rejectedOptions: ["Satin on the fins"], relatedToFocus: true,
  }],
  passages: [
    { sourceVersionId: SV1, sourceTitle: "Client brief", text: "Finish is matte throughout, because the film is shot under hard studio light.",
      rights: "permitted", citedBy: DEC, supportReviewed: true, relatedToFocus: true },
    { sourceVersionId: SV2, sourceTitle: "Internal returns data", text: "Seam failure caused 63% of warranty returns in Q1.",
      rights: "restricted", citedBy: null, supportReviewed: false, relatedToFocus: true },
  ],
  constraints: [{ objectId: CON, title: "Budget", kind: "range", value: 1500, relatedToFocus: true }],
  changes: [{ kind: "review", subject: "How should the prop be finished?", because: "the brief changed" }],
  ...over,
});
const remote: ContextPolicy = { destination: "remote", maxTokens: 6000, includeDecisions: true, includePassages: true, includeConstraints: true, includeChanges: true, onlyReviewedSupport: false };
const local: ContextPolicy = { ...remote, destination: "local" };

describe("the context compiler is pure", () => {
  it("compiles the same material and policy to the same included set and digest, every time", () => {
    const a = compileContext(material(), remote);
    const b = compileContext(material(), remote);
    expect(a.contextDigest).toBe(b.contextDigest);
    expect(a.included.map((i) => i.id)).toEqual(b.included.map((i) => i.id));
    expect(a.rendered).toBe(b.rendered);
  });

  it("is insensitive to the order material arrives in", () => {
    const m = material();
    const shuffled = material({ passages: [...m.passages].reverse(), decisions: [...m.decisions].reverse() });
    expect(compileContext(shuffled, remote).contextDigest).toBe(compileContext(m, remote).contextDigest);
  });

  it("changes its digest when what is sent changes", () => {
    const a = compileContext(material(), remote);
    const b = compileContext(material({ constraints: [{ objectId: CON, title: "Budget", kind: "range", value: 1000, relatedToFocus: true }] }), remote);
    expect(a.contextDigest).not.toBe(b.contextDigest);
  });
});

describe("decisions travel with their reasons", () => {
  it("sends the choice, the rationale, the rejected options, the assumptions and the steelman", () => {
    const plan = compileContext(material(), remote);
    const d = plan.included.find((i) => i.kind === "decision")!;
    expect(d.text).toContain("chosen: Matte throughout");
    expect(d.text).toContain("why: The brief is explicit");
    expect(d.text).toContain("rejected: Satin on the fins");
    expect(d.text).toContain("assumes: The film is shot under hard studio light — revisit if the shoot moves outdoors");
    expect(d.text).toContain("could be wrong because: Matte can look flat");
  });

  it("does not send drafts or superseded decisions", () => {
    const plan = compileContext(material({ decisions: [
      { ...material().decisions[0]!, state: "draft" },
      { ...material().decisions[0]!, objectId: DEC2, state: "superseded" },
    ] }), remote);
    expect(plan.included.filter((i) => i.kind === "decision")).toHaveLength(0);
    expect(plan.excluded.filter((e) => e.kind === "decision")).toHaveLength(2);
  });
});

describe("rights are applied in the compiler, not requested in a prompt", () => {
  it("excludes a restricted passage from a remote destination, with the reason", () => {
    const plan = compileContext(material(), remote);
    const gone = plan.excluded.find((e) => e.why === "restricted_rights")!;
    expect(gone).toBeDefined();
    expect(gone.label).toBe("Internal returns data");
    expect(plan.rendered).not.toContain("63% of warranty returns");
    expect(plan.includesRestricted).toBe(false);
  });

  it("includes it for a local destination, and says restricted material is in the block", () => {
    const plan = compileContext(material(), local);
    expect(plan.rendered).toContain("63% of warranty returns");
    expect(plan.includesRestricted).toBe(true);
  });
});

describe("what is left out is named, with why", () => {
  it("drops what does not fit, in order of priority, and lists it as over budget", () => {
    const plan = compileContext(material(), { ...remote, maxTokens: 60 });
    expect(plan.included[0]!.kind).toBe("focus");
    expect(plan.excluded.some((e) => e.why === "over_budget")).toBe(true);
    expect(plan.tokens).toBeLessThanOrEqual(60);
  });

  it("never drops the focus", () => {
    const plan = compileContext(material(), { ...remote, maxTokens: 1 });
    expect(plan.included.map((i) => i.kind)).toEqual(["focus"]);
  });

  it("excludes material not connected to the focus", () => {
    const plan = compileContext(material({ constraints: [{ objectId: CON, title: "Other project's budget", kind: "range", value: 9, relatedToFocus: false }] }), remote);
    expect(plan.excluded.find((e) => e.id === CON)!.why).toBe("outside_focus");
  });

  it("can exclude passages whose citation nobody has reviewed", () => {
    const plan = compileContext(material({ passages: [
      { sourceVersionId: SV1, sourceTitle: "Client brief", text: "matte throughout", rights: "permitted", citedBy: DEC, supportReviewed: false, relatedToFocus: true },
    ] }), { ...remote, onlyReviewedSupport: true });
    expect(plan.excluded[0]!.why).toBe("unresolved_support");
  });

  it("says in the block when a passage's support is not yet reviewed", () => {
    const plan = compileContext(material({ passages: [
      { sourceVersionId: SV1, sourceTitle: "Client brief", text: "matte throughout", rights: "permitted", citedBy: DEC, supportReviewed: false, relatedToFocus: true },
    ] }), remote);
    expect(plan.rendered).toContain("support not yet reviewed");
  });

  it("honours a shape the person allowed, and lists the rest as not requested", () => {
    const plan = compileContext(material(), { ...remote, includePassages: false, includeChanges: false });
    expect(plan.included.some((i) => i.kind === "passage")).toBe(false);
    expect(plan.excluded.filter((e) => e.why === "not_requested").length).toBeGreaterThan(0);
  });
});
