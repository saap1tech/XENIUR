import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { probeBlender } from "../local/probe.js";
import { noCost, numberArg, stringArg } from "../types.js";
import { runBlender } from "../local/blender.js";


/**
 * Stands in for a generative image-to-3D API. Rather than shipping a placeholder file,
 * it drives the local Blender worker to build a real procedural mesh — so the 3D
 * viewport, the deterministic post-processing and the STL export are all exercising
 * genuine geometry. Stamped "mock" everywhere it appears.
 */
export const mockMeshProvider: Provider = {
  id: "mock.mesh",
  kind: "mock",
  tools: ["3d.generate"],

  async available(env: ProviderEnv): Promise<Availability> {
    const state = await probeBlender(env.binaries.blender);
    return state.ok ? state : { ...state, reason: `mock 3D needs Blender — ${state.reason}` };
  },

  async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    const prompt = stringArg(call.args, "prompt") ?? "object";
    const digest = createHash("sha256").update(prompt).digest();

    const params = {
      name: prompt.replace(/[^a-z0-9]+/gi, "_").slice(0, 32) || "object",
      fins: 3 + (digest[0]! % 4),
      bodyRadius: 0.4 + (digest[1]! / 255) * 0.3,
      bodyHeight: 2.0 + (digest[2]! / 255) * 1.2,
      finSpan: 0.5 + (digest[3]! / 255) * 0.5,
      targetHeight: numberArg(call.args, "targetHeight") ?? 3.0,
      shadeSmooth: true,
      color: [digest[4]! / 255, digest[5]! / 255, digest[6]! / 255],
    };

    const outPath = join(env.scratchDir, `mesh-${newId()}.glb`);
    const result = await runBlender({ op: "generate_mesh", output: outPath, params }, env);

    return {
      outputs: [{
        data: readFileSync(outPath), mime: "model/gltf-binary",
        ext: "glb", modality: "mesh", format: "glb",
      }],
      provenance: "mock", model: "mock.mesh/v1",
      toolVersion: `xeniur mock 0.1.0 · blender ${result.blenderVersion}`,
      generationParams: { prompt, ...params, vertices: result.vertices, polygons: result.polygons },
      cost: noCost(Date.now() - started),
    };
  },
};
