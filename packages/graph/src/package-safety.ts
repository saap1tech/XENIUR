import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, normalize, isAbsolute } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A package this size is refused before a byte of it is written anywhere. */
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GB on disk
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024;  // 8 GB expanded
export const MAX_ENTRIES = 200_000;

export interface EntryReport {
  path: string;
  bytes: number;
  kind: "file" | "directory" | "link" | "other";
}

export interface ArchiveCheck {
  ok: boolean;
  problems: string[];
  entries: EntryReport[];
  expandedBytes: number;
}

/**
 * Everything that can be known about an archive without unpacking it.
 *
 * A `.xeniur` arrives from someone else, which makes it exactly as trustworthy as an email
 * attachment. The order matters more than any single check: this runs against the archive
 * as it sits on disk, before extraction, so a hostile one is refused rather than caught
 * halfway through writing itself into a person's machine.
 *
 * Refused outright:
 *   - absolute paths and any `..` segment — the classic escape from the staging directory
 *   - symlinks, hardlinks, devices and anything else that is not a plain file or directory
 *   - anything outside `manifest.json` and `blobs/`
 *   - an expansion ratio or total size that says "bomb" rather than "package"
 */
export async function inspectArchive(packagePath: string): Promise<ArchiveCheck> {
  const problems: string[] = [];
  const entries: EntryReport[] = [];

  const onDisk = statSync(packagePath).size;
  if (onDisk > MAX_PACKAGE_BYTES) {
    problems.push(`the file is ${(onDisk / 1e9).toFixed(1)} GB, larger than XENIUR will open`);
    return { ok: false, problems, entries, expandedBytes: 0 };
  }

  // Listing reads the headers only. Nothing is written, and nothing is executed.
  //
  // Two listings on purpose. `-tzf` prints one exact name per line and is the authority on
  // what the archive would write; `-tvzf` adds the type and size, but its columns differ
  // between GNU and BSD tar, so it is treated as supplementary rather than trusted for the
  // check that matters.
  let names: string[];
  let verbose: string;
  try {
    const plain = await exec("tar", ["-tzf", packagePath], { maxBuffer: 64 * 1024 * 1024 });
    names = plain.stdout.split("\n").map((n) => n.trim()).filter((n) => n !== "");
    const detailed = await exec("tar", ["-tvzf", packagePath], { maxBuffer: 64 * 1024 * 1024 });
    verbose = detailed.stdout;
  } catch (err) {
    problems.push(`this file is not a readable archive (${err instanceof Error ? err.message.split("\n")[0] : "unknown"})`);
    return { ok: false, problems, entries, expandedBytes: 0 };
  }

  if (names.length > MAX_ENTRIES) {
    problems.push(`${names.length} entries, more than XENIUR will open`);
    return { ok: false, problems, entries, expandedBytes: 0 };
  }

  const detail = new Map<string, { kind: EntryReport["kind"]; bytes: number }>();
  for (const line of verbose.split("\n")) {
    const parsed = parseTarLine(line);
    if (parsed) detail.set(parsed.path.replace(/\/$/, ""), { kind: parsed.kind, bytes: parsed.bytes });
  }

  let expandedBytes = 0;
  // The union: a name either listing knows about is a name that has to pass the checks.
  const allNames = [...new Set([...names, ...detail.keys()])];

  for (const raw of allNames) {
    const known = detail.get(raw.replace(/\/$/, ""));
    const entry: EntryReport = {
      path: raw,
      bytes: known?.bytes ?? 0,
      kind: known?.kind ?? (raw.endsWith("/") ? "directory" : "file"),
    };
    entries.push(entry);
    expandedBytes += entry.bytes;

    if (entry.kind === "link") {
      problems.push(`"${entry.path}" is a link, which a package may not contain`);
      continue;
    }
    if (entry.kind === "other") {
      problems.push(`"${entry.path}" is not a plain file or directory`);
      continue;
    }
    if (isAbsolute(entry.path) || entry.path.startsWith("/")) {
      problems.push(`"${entry.path}" is an absolute path`);
      continue;
    }
    // Checked on the normalised path, because "blobs/../../etc/x" normalises to an escape
    // that a naive prefix test would wave through.
    const normalised = normalize(entry.path).replace(/\/$/, "");
    if (normalised.startsWith("..") || normalised.split("/").includes("..")) {
      problems.push(`"${entry.path}" points outside the package`);
      continue;
    }
    if (normalised !== "manifest.json" && !normalised.startsWith("blobs/") && normalised !== "blobs") {
      problems.push(`"${entry.path}" is not part of a XENIUR package`);
    }
  }

  if (expandedBytes > MAX_EXPANDED_BYTES) {
    problems.push(
      `it expands to ${(expandedBytes / 1e9).toFixed(1)} GB from ${(onDisk / 1e6).toFixed(1)} MB, ` +
      `which XENIUR will not unpack`,
    );
  }
  if (!allNames.some((n) => normalize(n) === "manifest.json")) {
    problems.push("there is no manifest.json, so this is not a XENIUR package");
  }

  return { ok: problems.length === 0, problems, entries, expandedBytes };
}

/**
 * One line of `tar -tvzf`, for its type and size.
 *
 * GNU and BSD tar disagree about the middle columns — GNU prints `owner/group`, BSD prints
 * owner and group separately — so nothing here counts columns. The date is the anchor: the
 * name is whatever follows it, and the size is the last plain number before it. A line that
 * does not parse returns null, and the caller falls back to the exact name listing, which
 * is what the safety checks actually run on.
 */
function parseTarLine(line: string): EntryReport | null {
  const trimmed = line.trimEnd();
  const mode = /^([-dlbcps])[rwxsStT-]{9}/.exec(trimmed);
  if (!mode) return null;

  // "Sep  7 06:57", "Sep  7  2024", or "2024-09-07 06:57".
  const date = /(?:[A-Z][a-z]{2}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+/
    .exec(trimmed);
  if (!date) return null;

  const before = trimmed.slice(mode[0].length, date.index).trim().split(/\s+/);
  const rest = trimmed.slice(date.index + date[0].length);
  const sizes = before.filter((token) => /^\d+$/.test(token));

  return {
    // "link -> target" in a verbose listing; only the name matters here.
    path: rest.split(" -> ")[0]!.trim(),
    bytes: Number(sizes[sizes.length - 1] ?? 0),
    kind: mode[1] === "-" ? "file" : mode[1] === "d" ? "directory"
        : mode[1] === "l" ? "link" : "other",
  };
}

/**
 * Checks that every blob in the staging directory is the bytes its name claims.
 *
 * Content addressing is only a guarantee if somebody verifies it. A package whose blob has
 * been swapped would otherwise be imported and then trusted forever, with the hash in the
 * database asserting an integrity nobody ever checked.
 */
export function verifyBlobs(
  staging: string, blobs: Array<Record<string, unknown>>,
): string[] {
  const problems: string[] = [];
  for (const blob of blobs) {
    const sha = blob["sha256"] as string;
    const ext = blob["ext"] as string;
    const path = join(staging, "blobs", `${sha}.${ext}`);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      problems.push(`the package names a file it does not contain (${sha.slice(0, 12)}…)`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha) {
      problems.push(
        `a file's contents do not match its name (${sha.slice(0, 12)}… is actually ${actual.slice(0, 12)}…)`,
      );
    }
  }
  return problems;
}
