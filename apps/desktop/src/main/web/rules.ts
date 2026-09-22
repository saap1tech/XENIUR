import type { ProfileKind } from "@xeniur/core";

/**
 * The rules a browsing session is held to — pure, so they can be read and tested without
 * Electron.
 *
 * A profile the person signs into may POST: that is how signing in works, and refusing it
 * would make the browser a reader with a login box. Everything else stays — HTTPS only, the
 * address policy on every frame, the reputation check, the pinned proxy, no popups, no
 * webview, downloads held rather than taken. An ephemeral profile keeps the old rule: GET and
 * HEAD, and forms disabled by policy.
 *
 * While the assistant is acting in a tab, that view may not send anything anywhere except the
 * origins the person's grant names. The page cannot use the assistant's turn to post
 * elsewhere.
 */
export interface RequestFacts {
  method: string;
  url: string;
  resourceType: string;
}
export interface SessionMode {
  profileKind: ProfileKind;
  /** The assistant is acting in this view right now. */
  acting: boolean;
  /** Origins the acting grant covers. Empty means: while acting, send nowhere. */
  grantOrigins: readonly string[];
}

export type RequestVerdict = { allow: true } | { allow: false; because: string };

const originOf = (url: string): string | null => { try { return new URL(url).origin; } catch { return null; } };

/** Whether one request may leave this session, and why not when it may not. */
export function requestRule(mode: SessionMode, r: RequestFacts): RequestVerdict {
  const method = r.method.toUpperCase();
  const reading = method === "GET" || method === "HEAD";

  if (mode.profileKind === "ephemeral" && !reading) {
    return { allow: false, because: "This tab is for reading. Sign in with one of your accounts to send anything." };
  }
  if (mode.acting && !reading) {
    const origin = originOf(r.url);
    if (!origin || !mode.grantOrigins.includes(origin)) {
      return { allow: false, because: `While the assistant is acting here, nothing may be sent to ${origin ?? "that address"} — it is outside what you allowed.` };
    }
  }
  return { allow: true };
}

/**
 * The policy XENIUR adds to a response. An ephemeral tab disables forms outright; a signed-in
 * one keeps plugins and base-tag injection off and leaves forms to the person.
 */
export function cspFor(kind: ProfileKind): string {
  return kind === "ephemeral"
    ? "form-action 'none'; object-src 'none'; base-uri 'self'"
    : "object-src 'none'; base-uri 'self'";
}

/**
 * The session partition for a profile. A signed-in profile persists — and keeps the
 * `persist:web` prefix, which the IPC guard refuses outright, so a browsing view can never
 * reach a privileged handler whatever else is true of it.
 */
export function partitionFor(profileId: string, kind: ProfileKind): string {
  return kind === "signed_in" ? `persist:web:profile:${profileId}` : `web:profile:${profileId}`;
}

/** A downloaded file's name, made safe for the scratch folder. Never trusted as given. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "download";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+/, "").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "download";
}
