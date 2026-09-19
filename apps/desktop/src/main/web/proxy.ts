import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { checkedDestination } from "./policy.js";

/** HTTPS tunnel only. Each connection uses the validated IP, closing DNS rebinding races. */
export class PublicWebProxy {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  async start(): Promise<number> {
    const server = createServer((_req, res) => { res.writeHead(403); res.end(); });
    this.server = server;
    server.on("connect", (req, client, head) => {
      const socket = client as Socket;
      this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket));
      void (async () => {
        if (!req.url || !/^[a-zA-Z0-9.\-\[\]:]+:443$/.test(req.url)) throw new Error("HTTPS only");
        const { addresses } = await checkedDestination(`https://${req.url}`);
        if (socket.destroyed) return;
        const upstream = connect({ host: addresses[0]!.address, port: 443, family: addresses[0]!.family });
        this.sockets.add(upstream); upstream.on("close", () => this.sockets.delete(upstream));
        upstream.setTimeout(60_000, () => upstream.destroy());
        upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.destroy());
        upstream.once("connect", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          socket.pipe(upstream); upstream.pipe(socket);
        });
      })().catch(() => { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("Proxy unavailable"));
        resolve(address.port);
      });
    });
  }
  close(): void { for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); this.server?.close(); }
}
