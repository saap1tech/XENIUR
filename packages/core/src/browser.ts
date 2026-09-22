import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import type { WebRiskResult } from "./web.js";

/**
 * Browsing inside XENIUR: profiles, tabs, and what a tab is doing.
 *
 * A **profile** is one of the person's accounts — a session that persists, so signing in
 * stays signed in. An **ephemeral** profile keeps nothing and may only read. Tabs belong to a
 * project and, when there is one, a step; a tab with no project is unassigned browsing, which
 * is allowed and saves nothing anywhere.
 *
 * `browserState` is the word the person sees, and it is a fact about who is driving.
 */
export const PROFILE_KINDS = ["ephemeral", "signed_in"] as const;
export const ProfileKindSchema = z.enum(PROFILE_KINDS);
export type ProfileKind = z.infer<typeof ProfileKindSchema>;

export const BrowserProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  kind: ProfileKindSchema,
  partition: z.string().min(1),
  createdAt: TimestampSchema,
  lastUsedAt: TimestampSchema.nullable().default(null),
}).strict();
export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;

export const BROWSER_STATES = ["person", "assistant", "review"] as const;
export type BrowserState = (typeof BROWSER_STATES)[number];
export const BROWSER_STATE_WORDS: Record<BrowserState, string> = {
  person: "You are browsing",
  assistant: "Assistant is helping",
  review: "Waiting for your review",
};

export const BrowserTabSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  worldId: UuidSchema.nullable().default(null),
  goalId: UuidSchema.nullable().default(null),
  stepId: z.string().nullable().default(null),
  url: z.string().default(""),
  title: z.string().default(""),
  position: z.number().int().nonnegative().default(0),
  openedAt: TimestampSchema,
  closedAt: TimestampSchema.nullable().default(null),
}).strict();
export type BrowserTab = z.infer<typeof BrowserTabSchema>;

/** What a live tab is right now. Read from the view, never remembered. */
export interface TabState {
  tabId: string;
  profileId: string;
  profileLabel: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  risk: WebRiskResult | null;
  error: string | null;
  browserState: BrowserState;
  /** The webContents this tab *is* — what a grant binds to, so another view cannot stand in. */
  webContentsId: number | null;
}

/** A download XENIUR caught and is holding. The person decides whether it enters the project. */
export const HeldDownloadSchema = z.object({
  id: z.string().min(1),
  tabId: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().default(""),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  path: z.string().min(1),
  at: TimestampSchema,
}).strict();
export type HeldDownload = z.infer<typeof HeldDownloadSchema>;

/** What a snapshot of the visible, authenticated view carries. Never a fresh public fetch. */
export interface TabSnapshot {
  tabId: string;
  url: string;
  title: string;
  /** What the person had selected, if anything. */
  selectionText: string;
  /** The readable text of the main frame, capped. */
  pageText: string;
  at: number;
  profileLabel: string;
}

/** Downloads are held, never taken: this is the cap, in bytes. */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** How much page text a snapshot carries. */
export const MAX_SNAPSHOT_CHARS = 200_000;
