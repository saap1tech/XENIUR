import { describe, expect, it } from "vitest";
import { CapabilityRegistry, HOTEL_RESERVE_EXAMPLE } from "./index.js";

describe("XCDL capability manifests", () => {
  it("composes visual semantics and produces a brokerable plan without UI code", () => {
    const registry = new CapabilityRegistry(["xeniur.hands"]);
    const compiled = registry.register(HOTEL_RESERVE_EXAMPLE);
    expect(compiled.components).toEqual({
      where: "SchematicMap", when: "Calendar", who: "PeopleChips", cost: "ReviewSheet",
    });
    expect(compiled.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(compiled.manifest)).not.toMatch(/<script|function\s*\(|javascript:/i);
    const plan = registry.plan("hotel.reserve", {
      Hotel: { id: "11111111-1111-4111-8111-111111111111", traits: ["locatable", "priced", "temporal", "bookable"] },
      Dates: { id: "22222222-2222-4222-8222-222222222222", traits: ["temporal"] },
      People: { id: "33333333-3333-4333-8333-333333333333", traits: ["personLike"] },
      PaymentMethod: { id: "44444444-4444-4444-8444-444444444444", traits: ["external"] },
    }, { quotedPrice: 240 });
    expect(plan.tool).toBe("browser.submit");
    expect(plan.confirmation).toBe(true);
  });

  it("refuses untrusted execution adapters and subjects missing required traits", () => {
    const registry = new CapabilityRegistry(["xeniur.local"]);
    expect(() => registry.register(HOTEL_RESERVE_EXAMPLE)).toThrow(/not trusted/);
    const trusted = new CapabilityRegistry(["xeniur.hands"]);
    trusted.register(HOTEL_RESERVE_EXAMPLE);
    expect(() => trusted.plan("hotel.reserve", {
      Hotel: { id: "11111111-1111-4111-8111-111111111111", traits: ["locatable"] },
    }, { quotedPrice: 240 })).toThrow(/required traits|needs/);
  });
});
