import { describe, it, expect } from "vitest";
import { EN, MESSAGE_KEYS, t } from "./i18n.js";

describe("the language seam", () => {
  it("fills holes from variables and leaves a missing one visible", () => {
    expect(t("sr.proposals", { count: 3 })).toBe("3 proposals waiting for review. Nothing among them is recorded until you accept it.");
    expect(t("sr.proposals", {})).toContain("{count}");
  });

  it("keys name the place and the fact, not the English wording", () => {
    for (const key of MESSAGE_KEYS) {
      expect(key).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      expect(EN[key].length).toBeGreaterThan(0);
    }
  });

  it("screen-reader sentences are facts: no adjectives of praise or alarm", () => {
    const forbidden = /\b(great|beautiful|amazing|powerful|smart|easy|simple|urgent|critical|important)\b/i;
    for (const key of MESSAGE_KEYS.filter((k) => k.startsWith("sr."))) expect(EN[key]).not.toMatch(forbidden);
  });
});
