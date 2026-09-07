import type { Tool } from "@xeniur/core";

/**
 * Turns a pending side effect into one line a person can actually judge:
 * "Book court · 5:00 PM · $18". A preview that says "execute browser.submit" is
 * useless — the point of asking is that the person understands what they are approving.
 */
export type Previewer = (args: Record<string, unknown>) => string | null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const money = (args: Record<string, unknown>): string | null => {
  const amount = num(args["priceUsd"]) ?? num(args["amountUsd"]) ?? num(args["totalUsd"]);
  return amount === null ? null : `$${amount.toFixed(2)}`;
};

const join = (...parts: Array<string | null>): string =>
  parts.filter((p): p is string => p !== null && p !== "").join(" · ");

const DEFAULTS: Partial<Record<Tool, Previewer>> = {
  "browser.submit": (a) =>
    join(str(a["action"]) ?? str(a["label"]) ?? "Submit form",
         str(a["when"]), str(a["where"]) ?? str(a["site"]) ?? str(a["domain"]), money(a)),
  "browser.fill": (a) =>
    join(`Type into ${str(a["field"]) ?? "a field"}`, str(a["domain"])),
  "browser.click": (a) =>
    join(`Click ${str(a["label"]) ?? "control"}`, str(a["domain"])),
  "code.run": (a) => join("Run", str(a["entry"]) ?? "project", str(a["runtime"])),
  "export.file": (a) => join("Write file", str(a["path"])),
};

export class PreviewRegistry {
  private readonly previewers = new Map<Tool, Previewer>();

  constructor(overrides: Partial<Record<Tool, Previewer>> = {}) {
    for (const [tool, fn] of Object.entries({ ...DEFAULTS, ...overrides })) {
      if (fn) this.previewers.set(tool as Tool, fn);
    }
  }

  register(tool: Tool, previewer: Previewer): void { this.previewers.set(tool, previewer); }

  render(tool: Tool, args: Record<string, unknown>): string {
    const custom = this.previewers.get(tool)?.(args);
    if (custom && custom.trim() !== "") return custom;
    const subject = str(args["label"]) ?? str(args["title"]) ?? str(args["url"]) ?? str(args["domain"]);
    return join(tool.replace(/\./g, " "), subject, money(args)) || tool;
  }
}
