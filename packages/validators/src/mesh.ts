import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { ProviderEnv } from "@xeniur/providers";
import { run } from "@xeniur/providers";
import type { CheckResult, Validator, ValidationSubject } from "./types.js";
import { skipped } from "./types.js";

const MESH_FORMATS = new Set(["glb", "gltf", "stl", "obj"]);

interface MeshReport {
  vertices: number; polygons: number; triangles: number;
  nonManifoldEdges: number; boundaryEdges: number; ngons: number;
  dimensions: [number, number, number];
  volume: number;
}

/**
 * One Blender pass measures everything a mesh profile could ask about, because starting
 * Blender costs far more than any of the individual measurements.
 */
async function inspect(subject: ValidationSubject, env: ProviderEnv): Promise<MeshReport | null> {
  mkdirSync(env.scratchDir, { recursive: true });
  const path = join(env.scratchDir, `check-${newId()}.${subject.representation.format}`);
  writeFileSync(path, subject.bytes());

  const script = join(env.rootDir, "blender", "xeniur_inspect.py");
  const { stdout } = await run(env.binaries.blender,
    ["--background", "--python", script, "--", path], 180_000);

  const line = stdout.split("\n").find((l) => l.startsWith("XENIUR_INSPECT:"));
  return line ? (JSON.parse(line.slice("XENIUR_INSPECT:".length)) as MeshReport) : null;
}

const cache = new WeakMap<object, Promise<MeshReport | null>>();
const reportFor = (subject: ValidationSubject, env: ProviderEnv): Promise<MeshReport | null> => {
  const key = subject.representation as unknown as object;
  let pending = cache.get(key);
  if (!pending) { pending = inspect(subject, env); cache.set(key, pending); }
  return pending;
};

const meshValidator = (
  id: string,
  decide: (r: MeshReport, subject: ValidationSubject) => CheckResult,
): Validator => ({
  id,
  appliesTo: (s) => s.representation.modality === "mesh" && MESH_FORMATS.has(s.representation.format),
  async run(subject, env) {
    const report = await reportFor(subject, env);
    if (!report) return { status: "fail", summary: "Blender could not read this mesh", detail: {} };
    return decide(report, subject);
  },
});

/** A mesh with non-manifold edges will confuse a game engine and a slicer alike. */
export const meshManifold = meshValidator("mesh.manifold", (r) => ({
  status: r.nonManifoldEdges === 0 ? "pass" : "fail",
  summary: r.nonManifoldEdges === 0
    ? "every edge joins exactly two faces"
    : `${r.nonManifoldEdges} non-manifold edge${r.nonManifoldEdges === 1 ? "" : "s"}`,
  detail: { nonManifoldEdges: r.nonManifoldEdges },
}));

/** Printing needs a closed solid; an open boundary is a hole the slicer cannot fill. */
export const meshWatertight = meshValidator("mesh.watertight", (r) => ({
  status: r.boundaryEdges === 0 ? "pass" : "fail",
  summary: r.boundaryEdges === 0
    ? "the surface is closed"
    : `${r.boundaryEdges} open boundary edge${r.boundaryEdges === 1 ? "" : "s"} — this is not a solid`,
  detail: { boundaryEdges: r.boundaryEdges, volume: r.volume },
}));

/** Reports the count; the profile decides what is too many for its target. */
export const meshPolycount = meshValidator("mesh.polycount", (r) => ({
  status: "pass",
  summary: `${r.polygons.toLocaleString()} polygons, ${r.triangles.toLocaleString()} triangles`,
  detail: { polygons: r.polygons, triangles: r.triangles, vertices: r.vertices },
}));

export const meshDimensions = meshValidator("mesh.dimensions", (r, subject) => {
  const [x, y, z] = r.dimensions;
  const units = subject.properties.units;
  return {
    status: "pass",
    summary: `${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)}${units ? ` ${units}` : " (units not stated)"}`,
    detail: { x, y, z, units, longestEdge: Math.max(x, y, z) },
  };
});

/**
 * Printing a model whose units nobody wrote down is how you get a rocket the size of a
 * grain of rice. This checks the Object says what its numbers mean.
 */
export const objectUnits: Validator = {
  id: "object.units",
  appliesTo: (s) => s.representation.modality === "mesh",
  async run(subject) {
    const { units, dimensions } = subject.properties;
    if (!units) {
      return {
        status: "fail",
        summary: "no units recorded — a printed size cannot be trusted without them",
        detail: { units: null },
      };
    }
    return {
      status: "pass",
      summary: `sizes are in ${units}`,
      detail: { units, dimensions },
    };
  },
};

export const meshValidators: readonly Validator[] = [
  meshManifold, meshWatertight, meshPolycount, meshDimensions, objectUnits,
];

export { skipped };
