import { request } from "node:https";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { WebRiskResult } from "@xeniur/core";
import { checkedDestination, type Address, type Resolver } from "./policy.js";
import type { WebRiskChecker } from "./risk.js";

type TreeNode = DefaultTreeAdapterMap["node"];
const SKIP = new Set(["script", "style", "noscript", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "nav", "footer", "header", "svg", "canvas", "template"]);
export function extractReading(html: string): { title: string; text: string } {
  const document = parse(html);
  const children = (node: TreeNode): TreeNode[] => "childNodes" in node ? node.childNodes : [];
  const find = (node: TreeNode, tag: string): TreeNode | undefined => {
    if ("tagName" in node && node.tagName === tag) return node;
    for (const child of children(node)) { const found = find(child, tag); if (found) return found; }
    return undefined;
  };
  const text = (node: TreeNode): string => {
    if ("tagName" in node && SKIP.has(node.tagName)) return "";
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
    const value = children(node).map(text).join(" ");
    return "tagName" in node && ["p", "h1", "h2", "h3", "li", "section"].includes(node.tagName) ? `\n${value}\n` : value;
  };
  const titleNode = find(document, "title");
  const content = find(document, "article") ?? find(document, "main") ?? find(document, "body") ?? document;
  return {
    title: titleNode ? text(titleNode).replace(/\s+/g, " ").trim().slice(0, 300) : "Captured source",
    text: text(content).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 200_000),
  };
}

export interface FetchResult { status: number; location?: string; type: string; body: string; }
export type PinnedFetch = (url: URL, address: Address) => Promise<FetchResult>;
/** Connects to the checked IP, preserving TLS name verification. No cookies, scripts, or automatic redirects. */
export const fetchPinned: PinnedFetch = (url, address) => new Promise((resolve, reject) => {
  const req = request({
    hostname: address.address, family: address.family, servername: url.hostname,
    port: 443, path: url.pathname + url.search, method: "GET", agent: false,
    headers: { Host: url.host, Accept: "text/html,text/plain", "Accept-Encoding": "identity", "User-Agent": "XENIUR-Explore/1.0" },
  }, (res) => {
    const chunks: Buffer[] = []; let size = 0;
    res.on("error", reject);
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) { req.destroy(new Error("This source exceeds the 2 MB capture limit.")); return; }
      chunks.push(chunk);
    });
    res.on("end", () => resolve({ status: res.statusCode ?? 500,
      ...(res.headers.location ? { location: res.headers.location } : {}),
      type: res.headers["content-type"] ?? "", body: Buffer.concat(chunks).toString("utf8") }));
  });
  const deadline = setTimeout(() => req.destroy(new Error("The source took too long to respond.")), 15_000);
  req.on("close", () => clearTimeout(deadline));
  req.on("error", reject); req.end();
});

export async function captureWeb(input: string, risk: Pick<WebRiskChecker, "allow">,
  resolve?: Resolver, get: PinnedFetch = fetchPinned): Promise<{ title: string; text: string; url: string; risk: WebRiskResult }> {
  let target = input;
  for (let redirect = 0; redirect <= 4; redirect++) {
    const checked = await checkedDestination(target, resolve);
    const result = await risk.allow(checked.url.href);
    const response = await get(checked.url, checked.addresses[0]!);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      target = new URL(response.location, checked.url).href; continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`The site returned HTTP ${response.status}.`);
    if (!/^(text\/html|text\/plain)(;|$)/i.test(response.type)) throw new Error("Explore currently captures HTML and plain text. Import other files deliberately.");
    const reading = response.type.startsWith("text/plain")
      ? { title: checked.url.hostname, text: response.body.slice(0, 200_000) } : extractReading(response.body);
    if (!reading.text) throw new Error("No readable material was found. You can choose Live Site to inspect the webpage.");
    return { ...reading, url: checked.url.href, risk: result };
  }
  throw new Error("Too many redirects.");
}
