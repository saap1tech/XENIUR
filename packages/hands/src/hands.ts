import type { Authorization, Receipt, Tool, UntrustedContent } from "@xeniur/core";
import { newId, now, untrusted } from "@xeniur/core";
import type { PermissionBroker } from "@xeniur/permissions";
import type { SessionBroker } from "@xeniur/sessions";
import type { DriverFactory, ExtractedProduct, PageDriver } from "./driver.js";

export interface HandsOptions {
  sessions: SessionBroker;
  broker: PermissionBroker;
  factory: DriverFactory;
  /** Domains Hands may touch at all. Empty means "ask about everything", not "allow all". */
  allowlist?: readonly string[];
  searchUrl?: (query: string) => string;
  /** Stores a screenshot and returns its content address, for the receipt. */
  storeScreenshot?: (data: Buffer) => string;
}

export interface HandsContext {
  taskId?: string | null;
  taskTitle?: string;
  /** Permission for exactly this action, not a blanket yes. */
  authorization?: Authorization;
}

export interface PageResult {
  url: string;
  title: string;
  /** Page text, wrapped so no layer can lose track of the fact that it is data. */
  content: UntrustedContent;
  receipt: Receipt;
}

export interface ProductsResult {
  products: ExtractedProduct[];
  /** Also carried as untrusted: a product title is still text from a page. */
  content: UntrustedContent;
  receipt: Receipt;
}

export class DomainNotAllowed extends Error {
  readonly code = "domain_not_allowed" as const;
  constructor(readonly domain: string) {
    super(`XENIUR is not allowed to act on ${domain}. Add it to the allowlist first.`);
    this.name = "DomainNotAllowed";
  }
}

/**
 * XENIUR's Hands.
 *
 * A model never gets a browser; it gets these six verbs. Each one checks the domain
 * allowlist, obtains a scoped session grant, passes through the Permission Broker, and
 * writes a receipt when it did something consequential. There is deliberately no generic
 * navigate-and-evaluate function, because that is a shell by another name.
 */
export class Hands {
  // Genuine #private, not TypeScript's compile-time `private`: these must not be on the
  // prototype at runtime either. This class is the surface a model reaches through, so
  // "no escape hatch" has to be true of the object, not just of the type.
  #driver: PageDriver | null = null;
  #currentDomain: string | null = null;
  #lastGrantId: string | null = null;
  readonly #opts: HandsOptions;

  constructor(opts: HandsOptions) { this.#opts = opts; }

  /* ------------------------------------------------------------------ read */

  async searchWeb(query: string, ctx: HandsContext = {}): Promise<PageResult> {
    const url = (this.#opts.searchUrl ?? ((q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`))(query);
    return this.openPage(url, ctx);
  }

  async openPage(url: string, ctx: HandsContext = {}): Promise<PageResult> {
    const domain = this.#domainOf(url);
    this.#assertAllowed(domain);
    this.#opts.broker.guard({ tool: "browser.open", args: { url, domain }, scope: domain,
      plan: { tool: "browser.open", args: { url, domain }, destination: domain },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}) });

    const driver = await this.#driverFor(domain, ctx);
    await driver.goto(url);
    const [title, text] = await Promise.all([driver.title(), driver.text()]);

    return {
      url: driver.url(), title,
      content: untrusted({ kind: "web_page", origin: driver.url(), fetchedAt: now() }, text),
      receipt: await this.#receipt("browser.open", driver, { url }, ctx, `opened ${title}`),
    };
  }

  async extractProducts(ctx: HandsContext = {}): Promise<ProductsResult> {
    const driver = this.#requireDriver();
    const domain = this.#currentDomain ?? this.#domainOf(driver.url());
    this.#opts.broker.guard({ tool: "browser.extract", args: { domain }, scope: domain,
      plan: { tool: "browser.extract", args: { domain }, destination: domain },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}) });

    const products = await driver.products();
    return {
      products,
      content: untrusted(
        { kind: "web_page", origin: driver.url(), fetchedAt: now() },
        products.map((p) => `${p.title} — ${p.price ?? "?"}`).join("\n"),
      ),
      receipt: await this.#receipt("browser.extract", driver, { count: products.length }, ctx, `extracted ${products.length} products`),
    };
  }

  /* ----------------------------------------------------------------- write */

  async fillField(fieldLabel: string, value: string, ctx: HandsContext = {}): Promise<Receipt> {
    const driver = this.#requireDriver();
    const domain = this.#currentDomain ?? this.#domainOf(driver.url());
this.#opts.broker.guard({ tool: "browser.fill", args: { field: fieldLabel, domain }, scope: domain,
      plan: { tool: "browser.fill", args: { field: fieldLabel, domain }, destination: domain },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}) });
    await driver.fill(fieldLabel, value);
    // The value itself is deliberately not written to the receipt.
    return this.#receipt("browser.fill", driver, { field: fieldLabel }, ctx, `filled ${fieldLabel}`);
  }

  async clickElement(label: string, ctx: HandsContext = {}): Promise<Receipt> {
    const driver = this.#requireDriver();
    const domain = this.#currentDomain ?? this.#domainOf(driver.url());
    this.#opts.broker.guard({ tool: "browser.click", args: { label, domain }, scope: domain,
      plan: { tool: "browser.click", args: { label, domain }, destination: domain },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}) });
    await driver.click(label);
    return this.#receipt("browser.click", driver, { label }, ctx, `clicked ${label}`);
  }

  /**
   * Always COMMIT, always confirmed. The Broker throws ApprovalRequired unless a person
   * has explicitly approved this specific task, and the queue parks it until they do.
   */
  async submitForm(args: Record<string, unknown>, ctx: HandsContext = {}): Promise<Receipt> {
    const driver = this.#requireDriver();
    const domain = this.#currentDomain ?? this.#domainOf(driver.url());
    this.#opts.broker.guard({
      tool: "browser.submit", args: { ...args, domain }, scope: domain,
      plan: { tool: "browser.submit", args: { ...args, domain }, destination: domain },
      ...(ctx.authorization ? { authorization: ctx.authorization } : {}),
      // A form XENIUR found on a page is page-derived by definition.
      derivedFromUntrusted: true,
    });
    await driver.submit();
    return this.#receipt("browser.submit", driver, args, ctx, "submitted the form");
  }

  async close(): Promise<void> {
    await this.#driver?.close().catch(() => {});
    this.#driver = null;
    this.#currentDomain = null;
    await this.#opts.factory.shutdown();
  }

  /* --------------------------------------------------------------- private */

  #domainOf(url: string): string {
    try { return new URL(url).hostname; } catch { throw new Error(`not a usable url: ${url}`); }
  }

  #assertAllowed(domain: string): void {
    const list = this.#opts.allowlist;
    if (!list || list.length === 0) return;
    const ok = list.some((d) => domain === d || domain.endsWith(`.${d}`));
    if (!ok) throw new DomainNotAllowed(domain);
  }

  /**
   * Every page Hands opens comes from a scoped grant. In V1 that grant is always
   * anonymous, so a site the person is signed into in the visible browser is simply a
   * site Hands is signed out of.
   */
  async #driverFor(domain: string, ctx: HandsContext): Promise<PageDriver> {
    if (this.#driver && this.#currentDomain === domain) return this.#driver;
    await this.#driver?.close().catch(() => {});

    const grant = await this.#opts.sessions.authorize(
      domain, ctx.taskId ? { id: ctx.taskId, title: ctx.taskTitle ?? "" } : null,
    );
    const context = await this.#opts.sessions.getAutomationContext(domain, grant);
    this.#driver = await this.#opts.factory.create({
      storageState: context.storageState,
      acceptDownloads: context.options.acceptDownloads,
      bypassCSP: context.options.bypassCSP,
    });
    this.#currentDomain = domain;
    this.#lastGrantId = grant.grantId;
    return this.#driver;
  }

  #requireDriver(): PageDriver {
    if (!this.#driver) throw new Error("no page is open — call openPage or searchWeb first");
    return this.#driver;
  }

  async #receipt(
    tool: Tool, driver: PageDriver, params: Record<string, unknown>,
    _ctx: HandsContext, outcome: string,
  ): Promise<Receipt> {
    const [shot, digest] = await Promise.all([
      driver.screenshot().catch(() => null),
      driver.domDigest().catch(() => null),
    ]);
    return {
      screenshotBlobHash: shot && this.#opts.storeScreenshot ? this.#opts.storeScreenshot(shot) : null,
      domDigest: digest,
      url: driver.url(),
      params: { ...params, tool },
      sessionGrantId: this.#lastGrantId,
      outcome,
      at: now(),
    };
  }

  /** Exposed for the desktop shell, which shows the person which grant was used. */
  get grantId(): string | null { return this.#lastGrantId; }
  static newViewId(): string { return newId(); }
}
