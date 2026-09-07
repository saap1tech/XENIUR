export interface ExtractedProduct {
  title: string; price: string | null; url: string | null;
}

/**
 * The narrow surface Hands actually needs from a browser. Keeping it this small is the
 * point: there is no "run this selector" or "evaluate this script" escape hatch for a
 * model to reach through, and the Playwright binding underneath stays thin enough to
 * verify by reading it.
 */
export interface PageDriver {
  goto(url: string): Promise<void>;
  url(): string;
  title(): Promise<string>;
  text(): Promise<string>;
  products(): Promise<ExtractedProduct[]>;
  fill(fieldLabel: string, value: string): Promise<void>;
  click(label: string): Promise<void>;
  submit(): Promise<void>;
  screenshot(): Promise<Buffer>;
  domDigest(): Promise<string>;
  close(): Promise<void>;
}

export interface DriverFactory {
  /** Given an automation context that carries no credentials, produce a fresh page. */
  create(options: { storageState: null; acceptDownloads: false; bypassCSP: false }): Promise<PageDriver>;
  shutdown(): Promise<void>;
}
