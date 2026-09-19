import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FirstRun } from "./FirstRun.js";

/**
 * The first run is three scenes, all skippable. Each is rendered on its own here and must
 * expose Skip in the same weight as its forward verb. That skipping all three leaves every
 * local capability usable is the zero-key invariant, tested where the models live.
 */
const noop = () => {};
const scene = (step: 0 | 1 | 2) =>
  renderToStaticMarkup(<FirstRun onDone={noop} onImport={noop} onOpenExample={noop} initialStep={step} />);
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());

describe("first run — three scenes, each with Skip", () => {
  it("scene 1: the mark and one sentence, Skip beside Begin", () => {
    const html = scene(0);
    expect(html).toContain("keeps your sources, decisions and deliveries connected");
    expect(buttons(html)).toEqual(expect.arrayContaining(["Skip", "Begin"]));
    expect(html).not.toContain("<input");                                  // no form wall
  });

  it("scene 2: your models, Skip for now as a first-class exit, nothing key-shaped shown", () => {
    const html = scene(1);
    expect(buttons(html).some((t) => /^Skip/.test(t))).toBe(true);
    expect(html).toContain("Your models");
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{8}/);
  });

  it("scene 3: your first project, Skip beside the two ways in", () => {
    const html = scene(2);
    expect(html).toContain("Your first project");
    expect(buttons(html)).toContain("Skip");
    expect(html).toContain("Bring something in");
    expect(html).toContain("Open the example");
  });

  it("names all three scenes so Settings can reopen them by the same names", () => {
    const html = scene(0);
    for (const name of ["Welcome", "Your models", "Your first project"]) expect(html).toContain(name);
  });
});
