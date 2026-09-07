import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface RunResult { code: number; stdout: string; stderr: string; }

/** Runs a binary and collects its output. Never a shell — no string is ever interpolated. */
export function run(bin: string, args: string[], timeoutMs = 180_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${bin} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export const binaryExists = (path: string): boolean => existsSync(path);
