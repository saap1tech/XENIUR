import { describe, it, expect, vi } from "vitest";
import { GrantRefused } from "@xeniur/core";
import { READ_SCRIPT, TabDriver, type DriverElement, type DriverTab } from "./driver.js";

/**
 * The driver acts only where the person can watch, only within the grant, and never types a
 * password. Reading runs a fixed script in an isolated world — the script is bundled here, so
 * a test can read it and see there is nothing a model could have written into it.
 */
const el = (over: Partial<DriverElement> = {}): DriverElement =>
  ({ ref: "e1", role: "input", label: "Quantity", value: "", sensitive: false, rect: { x: 10, y: 20, width: 100, height: 30 }, ...over });

const tab = (over: Partial<DriverTab> = {}, elements: DriverElement[] = [el(), el({ ref: "e2", role: "button", label: "Place order" })]): DriverTab & { sent: Array<Record<string, unknown>> } => {
  const sent: Array<Record<string, unknown>> = [];
  return {
    webContentsId: 7, url: () => "https://supplier.example/orders", title: () => "Orders",
    visible: true, acting: true,
    read: async () => ({ url: "https://supplier.example/orders", title: "Orders", elements, selectionText: "" }),
    sendInput: (e) => { sent.push(e); },
    sent, ...over,
  } as DriverTab & { sent: Array<Record<string, unknown>> };
};

describe("acting in a tab the person can see", () => {
  it("reads through a fixed script, and the script touches nothing", () => {
    expect(READ_SCRIPT).toContain("document.querySelectorAll");
    for (const forbidden of [".click(", ".submit(", "fetch(", "XMLHttpRequest", "eval(", ".value ="]) {
      expect(READ_SCRIPT, `the read script must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("clicks at the element's own position, so the page's handlers run and the person sees it", async () => {
    const t = tab();
    await new TabDriver(t, "tab-1", () => {}, "g1").click("e2");
    expect(t.sent).toEqual([
      { type: "mouseDown", x: 60, y: 35, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 60, y: 35, button: "left", clickCount: 1 },
    ]);
  });

  it("refuses a password or payment field: the person types those", async () => {
    const t = tab({}, [el({ ref: "e1", label: "Password", sensitive: true })]);
    await expect(new TabDriver(t, "tab-1", () => {}, "g1").fill("e1", "hunter2")).rejects.toThrow(/yours to type/);
    expect(t.sent).toEqual([]);
  });

  it("refuses when the tab is not on screen, when the person took over, and when the grant says no", async () => {
    await expect(new TabDriver(tab({ visible: false }), "tab-1", () => {}, "g1").observe()).rejects.toThrow(/not on screen/);
    await expect(new TabDriver(tab({ acting: false }), "tab-1", () => {}, "g1").click("e2")).rejects.toThrow(/took over/);
    const refusing = () => { throw new GrantRefused("out_of_scope", "https://elsewhere.example"); };
    await expect(new TabDriver(tab(), "tab-1", refusing, "g1").click("e2")).rejects.toThrow(/outside what you allowed/);
  });

  it("asserts the grant against this exact view, origin and class before anything happens", async () => {
    const assert = vi.fn();
    const t = tab();
    const driver = new TabDriver(t, "tab-1", assert, "g1");
    await driver.observe();
    await driver.submit("e2");
    expect(assert.mock.calls[0]![0]).toEqual({ kind: "observation", tabId: "tab-1", webContentsId: 7, url: "https://supplier.example/orders" });
    // The action is asserted before the page is read again to find the control.
    expect(assert.mock.calls.map((c) => c[0].kind)).toEqual(["observation", "action", "observation"]);
    expect(assert.mock.calls[1]![0]).toMatchObject({ kind: "action", actionClass: "submit", webContentsId: 7, tabId: "tab-1" });
  });

  it("submits by pressing the control that was described, never by pressing Enter", async () => {
    const t = tab();
    await expect(new TabDriver(t, "tab-1", () => {}, "g1").submit("e1")).rejects.toThrow(/not a control that submits/);
    expect(t.sent.some((e) => e["keyCode"] === "\r" || e["type"] === "keyDown")).toBe(false);
  });
});
