import { describe, it, expect, beforeEach } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeBinary, probeBlender, clearProbeCache } from "./index.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xeniur-probe-")); clearProbeCache(); });

describe("availability means it actually runs", () => {
  it("reports a real binary as available, with what it printed", async () => {
    const state = await probeBlender("/Applications/Blender.app/Contents/MacOS/Blender");
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.detail).toMatch(/^Blender /);
      expect(state.checkedAt).toBeGreaterThan(0);
    }
  });

  it("reports a binary that exists but cannot run as unavailable, and says why", async () => {
    // The exact case a file-exists check gets wrong: present, executable, broken.
    const broken = join(dir, "broken-tool");
    writeFileSync(broken, "#!/bin/sh\necho 'dyld: library not loaded' >&2\nexit 1\n");
    chmodSync(broken, 0o755);

    const state = await probeBinary("broken", broken, ["--version"]);
    expect(state.ok).toBe(false);
    if (!state.ok) {
      expect(state.reason).toContain("present but not runnable");
      expect(state.reason).toContain("dyld");
    }
  });

  it("reports a missing binary as missing", async () => {
    const state = await probeBinary("absent", join(dir, "nope"), ["--version"]);
    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.reason).toContain("not found");
  });

  it("caches briefly, then re-checks — so a tool installed later is noticed", async () => {
    const tool = join(dir, "later");
    const first = await probeBinary("later", tool, ["--version"]);
    expect(first.ok).toBe(false);

    writeFileSync(tool, "#!/bin/sh\necho ok\n");
    chmodSync(tool, 0o755);

    expect((await probeBinary("later", tool, ["--version"])).ok).toBe(false);  // still cached
    clearProbeCache("later");
    expect((await probeBinary("later", tool, ["--version"])).ok).toBe(true);   // re-checked
  });
});
