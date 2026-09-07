import { protocol } from "electron";
import type { ObjectGraph } from "@xeniur/graph";

export const BLOB_SCHEME = "xeniur-blob";

export function registerBlobScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: BLOB_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
  }]);
}

/**
 * Serves content-addressed assets to XENIUR's own renderer. A content address is not a
 * path: there is no way to name a file outside the blob store through this scheme.
 */
export function installBlobProtocol(graph: ObjectGraph): void {
  protocol.handle(BLOB_SCHEME, (request) => {
    const hash = new URL(request.url).pathname.replace(/^\//, "");
    if (!/^[0-9a-f]{64}$/.test(hash)) return new Response("bad address", { status: 400 });

    const row = graph.db.prepare(`SELECT ext, mime FROM blobs WHERE sha256 = ?`).get(hash) as
      { ext: string; mime: string } | undefined;
    if (!row) return new Response("not found", { status: 404 });

    try {
      const data = graph.blobs.read(hash, row.ext);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { "content-type": row.mime, "cache-control": "public, max-age=31536000, immutable" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
