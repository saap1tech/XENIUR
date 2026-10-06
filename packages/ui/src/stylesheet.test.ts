import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The stylesheet is one generation.
 *
 * Three generations had been layered on each other — a legacy Home, an M4 override block that
 * redefined the shell, and M5 additions — and the cascade quietly decided which one won. These
 * tests make the stylesheet say what it means once: a selector is defined in one place, every
 * class a component uses exists, and every class the stylesheet defines is used.
 */
const root = process.cwd();
const cssPath = join(root, "apps/desktop/src/renderer/styles.css");
const raw = readFileSync(cssPath, "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|^out$|dist/.test(f)) sources(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const tsx = [...sources(join(root, "apps/desktop/src/renderer")), ...sources(join(root, "packages/ui/src"))].join("\n");

/** Top-level rules only; @media blocks are legitimate redefinitions and are skipped. */
const topLevel = css.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\}\s*\}/g, "").replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, "");
const selectors = topLevel.split("}").map((b) => b.split("{")[0]?.trim() ?? "").filter((s) => s && !s.startsWith("@"))
  .flatMap((group) => group.split(",").map((s) => s.trim().replace(/\s+/g, " ")));

describe("the stylesheet is one generation", () => {
  it("defines every selector exactly once outside media queries", () => {
    const seen = new Map<string, number>();
    for (const s of selectors) seen.set(s, (seen.get(s) ?? 0) + 1);
    const dups = [...seen].filter(([, n]) => n > 1).map(([s, n]) => `${n}× ${s}`);
    expect(dups, dups.join("\n")).toEqual([]);
  });

  const defined = new Set([...css.matchAll(/\.(xr-[a-zA-Z0-9_-]+)/g)].map((m) => m[1]!));
  const referenced = new Set([...tsx.matchAll(/\b(xr-[a-zA-Z0-9_-]+)/g)].map((m) => m[1]!));
  // A template literal like `xr-tag--${kind}` makes a family; its members are live by construction.
  const families = [...tsx.matchAll(/(xr-[a-zA-Z0-9_-]*?(?:--|__|-))\$\{/g)].map((m) => m[1]!);
  const inFamily = (c: string) => families.some((f) => c.startsWith(f));

  it("defines no class that no component uses", () => {
    const dead = [...defined].filter((c) => !referenced.has(c) && !inFamily(c)).sort();
    expect(dead, dead.join("\n")).toEqual([]);
  });

  /**
   * Classes a component carries as structure or a test hook without asking for paint. Listed
   * so that the next `.xr-rail__foot` — a class that needs a rule and has none — is caught,
   * while a hook stays a hook. Adding to this list is a decision, not a fix.
   */
  const UNSTYLED_HOOKS = new Set([
    "xr-causal--rebuild", "xr-causal--review", "xr-check__summary", "xr-claimcard__by", "xr-compare__meta",
    "xr-decision__actions", "xr-decision__chosen", "xr-decision__evidence", "xr-dna__statement", "xr-dna__statements",
    "xr-form__file", "xr-friction__actions", "xr-impact__item--review", "xr-inspector", "xr-models-title",
    "xr-orbit__forms", "xr-pair__claim--left", "xr-pair__claim--right", "xr-palette__label", "xr-panel__actions",
    "xr-path__happened", "xr-spatial__edges", "xr-support__label", "xr-table", "xr-version__forms", "xr-version__label",
  ]);

  it("uses no static class the stylesheet does not define", () => {
    // Static references only: a name that ends where a template starts is a family prefix.
    const staticRefs = [...referenced].filter((c) => !c.endsWith("-") && !families.includes(c) && !UNSTYLED_HOOKS.has(c));
    const missing = staticRefs.filter((c) => !defined.has(c) && !/^xr-(scene-slot|canvas)--/.test(c)).sort();
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("shapes come from the three radius tokens, never a literal", () => {
    const literals = [...topLevel.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]!.trim())
      .filter((v) => v.split(/\s+/).some((part) => !/^var\(--r-(card|control|tag)\)$/.test(part) && part !== "0" && part !== "50%"));
    expect(literals, [...new Set(literals)].join(", ")).toEqual([]);
  });

  /* M6 A7 — direction, motion and contrast are properties of the stylesheet, not of a screen. */
  it("writes direction with logical properties, so RTL is a translation and not a rewrite", () => {
    const physical = [...css.matchAll(/(?<![\w-])((?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?|border-(?:top|bottom)-(?:left|right)-radius|text-align:\s*(?:left|right)|float:\s*(?:left|right)|(?:^|[\s;{])(?:left|right)\s*:)/gm)]
      .map((m) => m[1]!.trim());
    expect(physical, [...new Set(physical)].join(", ")).toEqual([]);
  });

  it("moves only in paint and small lifts: every transition, opacity-only work animations, a logo path reveal, and one 240 ms settle", () => {
    // Hover and press may ease colour, depth and a small translate; nothing animates layout.
    const allowed = /^(opacity|color|background-color|border-color|box-shadow|transform)\b/;
    const transitions = [...css.matchAll(/transition:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
    for (const value of transitions) for (const part of value.split(",")) expect(part.trim(), value).toMatch(allowed);
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\}\s*\}/g)];
    for (const frame of keyframes) {
      const body=frame[2]!;
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      expect(props.every((p) => p === (frame[1] === "xr-splash-draw" ? "stroke-dashoffset" : "opacity")), body).toBe(true);
    }
    expect(css).toMatch(/@keyframes xr-settle/);
    expect(css).toMatch(/\.xr-trust\.is-settled\s*\{\s*animation:\s*xr-settle 240ms/);
    // One reduced-motion rule, and it silences everything.
    expect(css.match(/prefers-reduced-motion:\s*reduce/g)?.length).toBe(1);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?animation-duration:\s*\.001ms\s*!important/);
  });

  it("offers a high-contrast set that changes the quiet ramp and never the signal", () => {
    const blocks = [...raw.matchAll(/(prefers-contrast: more|data-contrast="high"\])[^{]*\{([^}]*)\}/g)].map((m) => m[2]!);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block).toMatch(/--line:/);
      expect(block).not.toMatch(/--signal/);
      expect(block).not.toMatch(/--bg:/);
    }
  });
});
