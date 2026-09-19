import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class WebPolicyError extends Error {
  readonly code = "web_policy_blocked";
}
export interface Address { address: string; family: number; }
export type Resolver = (hostname: string) => Promise<Address[]>;
export const resolvePublic: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address.replace(/^\[|\]$/g, ""));
    return parsed.range() === "unicast";
  } catch { return false; }
}

/** Shared by captures, navigation, redirects, subresources, and the CONNECT proxy. */
export function localUrlPolicy(input: string): URL {
  if (input.length > 4096) throw new WebPolicyError("The address is too long.");
  let url: URL;
  try { url = new URL(input); } catch { throw new WebPolicyError("Enter a complete HTTPS address."); }
  if (url.protocol !== "https:") throw new WebPolicyError("Only HTTPS destinations are allowed.");
  if (url.username || url.password) throw new WebPolicyError("Addresses containing credentials are blocked.");
  if (url.port && url.port !== "443") throw new WebPolicyError("Only the standard HTTPS port is allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!hostname || hostname.includes("%") || !hostname.includes(".") && !hostname.includes(":")) {
    throw new WebPolicyError("Local network names are blocked.");
  }
  if (/(^|\.)(localhost|local|internal|lan|home|onion)$/.test(hostname)) {
    throw new WebPolicyError("Local and private destinations are blocked.");
  }
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) {
    throw new WebPolicyError("Private, loopback, link-local, and reserved addresses are blocked.");
  }
  url.hash = "";
  return url;
}

export async function checkedDestination(input: string, resolve: Resolver = resolvePublic): Promise<{
  url: URL; addresses: Address[];
}> {
  const url = localUrlPolicy(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = ipaddr.isValid(hostname)
      ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4 }]
      : await Promise.race([resolve(hostname), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WebPolicyError("Address lookup timed out.")), 5000);
      })]);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new WebPolicyError("This address resolves to a private or reserved network.");
    }
    return { url, addresses };
  } finally { if (timer) clearTimeout(timer); }
}
