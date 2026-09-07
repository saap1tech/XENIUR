import { createHash } from "node:crypto";
import type { Browser, Page } from "playwright";
import type { DriverFactory, ExtractedProduct, PageDriver } from "./driver.js";

/**
 * Playwright drives a browser entirely separate from XENIUR's visible Electron shell.
 * It never automates a privileged view, and it is handed a context with no storage
 * state — see SessionBroker for why a session is granted rather than inherited.
 */
class PlaywrightDriver implements PageDriver {
  constructor(private readonly page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  url(): string { return this.page.url(); }
  async title(): Promise<string> { return this.page.title(); }
  async text(): Promise<string> {
    return this.page.evaluate(() => document.body?.innerText?.slice(0, 20_000) ?? "");
  }

  async products(): Promise<ExtractedProduct[]> {
    return this.page.evaluate(() => {
      const out: Array<{ title: string; price: string | null; url: string | null }> = [];
      const nodes = document.querySelectorAll("[itemtype*='Product'], [data-product], li, article");
      for (const node of Array.from(nodes).slice(0, 200)) {
        const text = (node as HTMLElement).innerText ?? "";
        const price = /([$£€]\s?\d[\d.,]*)/.exec(text)?.[1] ?? null;
        const heading = node.querySelector("h1, h2, h3, [itemprop='name']");
        const title = (heading as HTMLElement | null)?.innerText?.trim() ?? "";
        const href = (node.querySelector("a") as HTMLAnchorElement | null)?.href ?? null;
        if (title && price) out.push({ title: title.slice(0, 200), price, url: href });
      }
      return out.slice(0, 50);
    });
  }

  async fill(fieldLabel: string, value: string): Promise<void> {
    await this.page.getByLabel(fieldLabel).first().fill(value, { timeout: 15_000 });
  }
  async click(label: string): Promise<void> {
    await this.page.getByRole("button", { name: label }).first().click({ timeout: 15_000 });
  }
  async submit(): Promise<void> {
    await this.page.keyboard.press("Enter");
    await this.page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  }
  async screenshot(): Promise<Buffer> { return this.page.screenshot({ type: "png" }); }
  async domDigest(): Promise<string> {
    const html = await this.page.content();
    return createHash("sha256").update(html).digest("hex");
  }
  async close(): Promise<void> { await this.page.context().close(); }
}

export class PlaywrightFactory implements DriverFactory {
  private browser: Browser | null = null;
  constructor(private readonly headless = true) {}

  async create(options: { storageState: null; acceptDownloads: false; bypassCSP: false }): Promise<PageDriver> {
    if (!this.browser) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: this.headless });
    }
    // storageState is null by construction: nothing is ever carried over from the
    // visible browser, and this call site is the only place a context is created.
    const context = await this.browser.newContext({
      storageState: options.storageState ?? undefined,
      acceptDownloads: options.acceptDownloads,
      bypassCSP: options.bypassCSP,
    });
    return new PlaywrightDriver(await context.newPage());
  }

  async shutdown(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
