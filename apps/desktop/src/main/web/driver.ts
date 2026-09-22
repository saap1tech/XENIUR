import type { ActionClass } from "@xeniur/core";
import { GrantRefused } from "@xeniur/core";

/**
 * Acting in a tab the person can see.
 *
 * Reading runs a fixed, bundled script in an isolated world: never the main world, never code
 * a model wrote. Acting synthesises input at the element's own position, so the page's own
 * handlers run and the person watches it happen — a separate automated browser would be a
 * separate identity doing work nobody can see, which is why XENIUR does not use one here.
 *
 * Every call asserts the grant first, against this exact view and the origin it is on. A
 * password or a payment field is never filled by the assistant: the person types those.
 */
export interface DriverElement {
  ref: string;
  role: "input" | "button" | "link" | "heading" | "text";
  label: string;
  value?: string;
  sensitive: boolean;
  rect: { x: number; y: number; width: number; height: number };
}
export interface DriverReading {
  url: string;
  title: string;
  elements: DriverElement[];
  selectionText: string;
  at: number;
}

/** What the driver needs of a tab. The manager provides it; tests provide a fake. */
export interface DriverTab {
  webContentsId: number;
  url(): string;
  title(): string;
  visible: boolean;
  acting: boolean;
  read(script: string): Promise<unknown>;
  sendInput(event: Record<string, unknown>): void;
}

/** The grant check, in the trusted process. Throws `GrantRefused` with a code and words. */
export type AssertGrant = (need: { kind: "observation" | "action"; tabId: string; webContentsId: number; url: string; actionClass?: ActionClass }) => void;

export const READ_SCRIPT = `(() => {
  const out = [];
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => (el.getAttribute("aria-label") || el.labels?.[0]?.innerText || el.placeholder || el.name || el.innerText || "").trim().slice(0, 120);
  let n = 0;
  for (const el of document.querySelectorAll("input, textarea, select, button, a[href], h1, h2")) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    out.push({
      ref: "e" + (++n),
      role: tag === "button" || (tag === "input" && (type === "submit" || type === "button")) ? "button"
        : tag === "a" ? "link" : tag === "h1" || tag === "h2" ? "heading" : "input",
      label: label(el),
      value: tag === "input" || tag === "textarea" ? String(el.value ?? "").slice(0, 200) : undefined,
      sensitive: type === "password" || auto.startsWith("cc-") || auto === "one-time-code",
      rect: box(el),
    });
    if (n >= 200) break;
  }
  return { url: location.href, title: document.title, elements: out,
    selectionText: ((window.getSelection && window.getSelection().toString()) || "").slice(0, 20000) };
})()`;

export class TabDriver {
  constructor(private readonly tab: DriverTab, private readonly tabId: string, private readonly assert: AssertGrant, private readonly grantId: string) {}

  /** Reading the page. Refused unless the person allowed observation of this exact view. */
  async observe(): Promise<DriverReading> {
    this.#bound("observation");
    const read = await this.tab.read(READ_SCRIPT) as Omit<DriverReading, "at">;
    return { ...read, at: Date.now() };
  }

  /** Typing into a field the person named. Never a password, never a payment field. */
  async fill(ref: string, value: string): Promise<void> {
    this.#bound("action", "fill");
    const el = await this.#element(ref);
    if (el.sensitive) throw new GrantRefused("class_not_granted", "a password or payment field is yours to type, never the assistant's");
    this.#click(el);
    for (const ch of value) this.tab.sendInput({ type: "char", keyCode: ch });
  }

  async click(ref: string): Promise<void> {
    this.#bound("action", "click");
    this.#click(await this.#element(ref));
  }

  /** Pressing the control the review named. No Enter fallback: submitting is a described click. */
  async submit(ref: string): Promise<void> {
    this.#bound("action", "submit");
    const el = await this.#element(ref);
    if (el.role !== "button") throw new GrantRefused("class_not_granted", `"${el.label}" is not a control that submits`);
    this.#click(el);
  }

  #click(el: DriverElement): void {
    const x = Math.round(el.rect.x + el.rect.width / 2);
    const y = Math.round(el.rect.y + el.rect.height / 2);
    this.tab.sendInput({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    this.tab.sendInput({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  async #element(ref: string): Promise<DriverElement> {
    const reading = await this.observe();
    const el = reading.elements.find((e) => e.ref === ref);
    if (!el) throw new GrantRefused("out_of_scope", `the page no longer has "${ref}"`);
    return el;
  }

  /**
   * Bound to the visible view: this tab, this webContents, this origin, and the person not
   * having taken over. A tab that is not on screen is not a tab the assistant may act in.
   */
  #bound(kind: "observation" | "action", actionClass?: ActionClass): void {
    if (!this.tab.visible) throw new GrantRefused("wrong_tab", "that tab is not on screen");
    if (kind === "action" && !this.tab.acting) throw new GrantRefused("paused", "you took over");
    this.assert({ kind, tabId: this.tabId, webContentsId: this.tab.webContentsId, url: this.tab.url(), ...(actionClass ? { actionClass } : {}) });
  }
}
