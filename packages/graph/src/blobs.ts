import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StoredBlob { sha256: string; bytes: number; mime: string; ext: string; }

/**
 * Content-addressed file store. Large assets — PNG, MP4, GLB, STL, generated code —
 * never enter SQLite; the database holds only the address. Identical bytes written
 * twice occupy one file, which is what makes a version chain cheap.
 */
export class BlobStore {
  constructor(private readonly root: string) { mkdirSync(root, { recursive: true }); }

  /** root/ab/cd/<sha256>.<ext> — two levels of fan-out keeps directories small. */
  pathFor(sha256: string, ext: string): string {
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${ext}`);
  }

  put(data: Buffer, mime: string, ext: string): StoredBlob {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const path = this.pathFor(sha256, ext);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    }
    return { sha256, bytes: data.byteLength, mime, ext };
  }

  read(sha256: string, ext: string): Buffer { return readFileSync(this.pathFor(sha256, ext)); }
  has(sha256: string, ext: string): boolean { return existsSync(this.pathFor(sha256, ext)); }
}
