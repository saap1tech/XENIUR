import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewSupportBinding } from "./reviewSupport.js";

/** Gate 0: citation review saves through the bridge, refreshes, and fails in words. */
describe("reviewSupportBinding", () => {
  it("saves, then refreshes once", async () => {
    const save = vi.fn(async () => ({}));
    const refresh = vi.fn(async () => undefined);
    const notify = vi.fn();
    await reviewSupportBinding({ save, refresh, notify })("s1", "contradicted");
    expect(save).toHaveBeenCalledWith("s1", "contradicted");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("a failed save notifies in words and refreshes nothing — no false success", async () => {
    const save = vi.fn(async () => { throw new Error("no such support row"); });
    const refresh = vi.fn(async () => undefined);
    const notify = vi.fn();
    await reviewSupportBinding({ save, refresh, notify })("s1", "supported");
    expect(notify).toHaveBeenCalledWith("The review was not saved: no such support row");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("both workspaces supply the binding", () => {
    for (const f of ["World.tsx", "ObjectView.tsx"]) {
      expect(readFileSync(join(__dirname, "..", f), "utf8"), `${f} must wire onReviewSupport`).toContain("onReviewSupport");
    }
  });
});
