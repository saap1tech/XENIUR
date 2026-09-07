import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256.js";

/**
 * Checked against the published vectors, and then against Node's own implementation.
 *
 * This exists because `@xeniur/core` is bundled into the renderer, where `node:crypto`
 * does not exist, and a permission bound to a plan digest is a security decision that must
 * be synchronous. A hash written by hand earns its place only by being verified.
 */
describe("sha256 matches the specification", () => {
  it("produces the published NIST vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node for a message spanning several blocks", () => {
    const long = "the quick brown fox ".repeat(200);
    expect(sha256Hex(long)).toBe(createHash("sha256").update(long, "utf8").digest("hex"));
  });

  it("agrees with node at every length around a block boundary", () => {
    // 55/56 and 63/64 are where the padding decides whether to add another block.
    for (const n of [53, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128]) {
      const message = "x".repeat(n);
      expect(sha256Hex(message), `length ${n}`)
        .toBe(createHash("sha256").update(message, "utf8").digest("hex"));
    }
  });

  it("encodes non-ASCII the same way node does", () => {
    for (const message of ["café", "日本語のテキスト", "🚀 rocket", "naïve — dash"]) {
      expect(sha256Hex(message), message)
        .toBe(createHash("sha256").update(message, "utf8").digest("hex"));
    }
  });

  it("changes completely when one bit of the input changes", () => {
    const a = sha256Hex("approve $18.00");
    const b = sha256Hex("approve $18.01");
    expect(a).not.toBe(b);
    const differing = [...a].filter((ch, i) => ch !== b[i]).length;
    expect(differing).toBeGreaterThan(40);   // of 64 hex characters
  });
});
