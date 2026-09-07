import { z } from "zod";
import type { PermissionLevel } from "./permissions.js";

/** The eight Capability Router interfaces. Nothing reaches the outside world otherwise. */
export const CAPABILITIES = [
  "think", "image", "video", "to3D", "code", "browser", "transform", "export",
] as const;
export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * The closed set of tools an Action Plan may name. The Brain cannot invent a tool:
 * a plan naming anything outside this list fails schema validation and never executes.
 */
export const TOOLS = [
  "object.create", "object.update", "object.move",
  "import.file", "export.package",
  "image.generate", "image.transform",
  "3d.generate", "3d.process", "3d.export", "3d.solidify", "3d.render", "3d.turntable",
  "video.generate", "video.edit", "video.export",
  "code.scaffold", "code.patch", "code.run",
  "doc.write",
  "browser.search", "browser.open", "browser.extract",
  "browser.fill", "browser.click", "browser.submit",
  "export.file",
] as const;
export const ToolSchema = z.enum(TOOLS);
export type Tool = z.infer<typeof ToolSchema>;

export interface ToolSpec {
  readonly capability: Capability;
  /** Baseline consequence. The Broker may raise this, never lower it. */
  readonly permission: PermissionLevel;
  /** True when the tool can reach a third party. Forces receipt capture. */
  readonly external: boolean;
  readonly summary: string;
}

export const TOOL_SPECS: Readonly<Record<Tool, ToolSpec>> = {
  "object.create":   { capability: "transform", permission: "CREATE", external: false, summary: "Create a new Object in the World." },
  "object.update":   { capability: "transform", permission: "MODIFY", external: false, summary: "Change an Object's title, type or metadata." },
  "object.move":     { capability: "transform", permission: "MODIFY", external: false, summary: "Move an Object on the canvas." },

  "import.file":     { capability: "transform", permission: "CREATE", external: false, summary: "Bring a file in as a form of an Object, keeping the original." },
  "export.package":  { capability: "export",    permission: "CREATE", external: false, summary: "Write a portable .xeniur containing everything an Object is." },

  "image.generate":  { capability: "image",     permission: "CREATE", external: true,  summary: "Generate pixels that do not exist yet." },
  "image.transform": { capability: "transform", permission: "MODIFY", external: false, summary: "Crop, resize, rotate, recolour, composite, convert. Deterministic." },

  "3d.generate":     { capability: "to3D",      permission: "CREATE", external: true,  summary: "Imagine new geometry from an image or text." },
  "3d.process":      { capability: "transform", permission: "MODIFY", external: false, summary: "Scale, clean, modify, material, camera. Blender, deterministic." },
  "3d.export":       { capability: "export",    permission: "CREATE", external: false, summary: "Write GLB or STL." },
  "3d.solidify":     { capability: "transform", permission: "MODIFY", external: false, summary: "Close a surface so a slicer will accept it. Blender, deterministic." },
  "3d.render":       { capability: "transform", permission: "CREATE", external: false, summary: "Render a still of a mesh. Blender, deterministic." },
  "3d.turntable":    { capability: "video",     permission: "CREATE", external: false, summary: "Render a turntable and assemble it with FFmpeg. Deterministic." },

  "video.generate":  { capability: "video",     permission: "CREATE", external: true,  summary: "Generate frames that do not exist yet." },
  "video.edit":      { capability: "transform", permission: "MODIFY", external: false, summary: "Trim, concat, scale, mix, subtitle. FFmpeg, deterministic." },
  "video.export":    { capability: "export",    permission: "CREATE", external: false, summary: "Render the timeline to a file." },

  "code.scaffold":   { capability: "code",      permission: "CREATE", external: true,  summary: "Create a project filesystem for a code Object." },
  "code.patch":      { capability: "code",      permission: "MODIFY", external: true,  summary: "Patch individual files. Never regenerate a whole project." },
  "code.run":        { capability: "code",      permission: "MODIFY", external: false, summary: "Run a code Object in an isolated runtime." },

  "doc.write":       { capability: "code",      permission: "MODIFY", external: true,  summary: "Write or revise document text." },

  "browser.search":  { capability: "browser",   permission: "READ",   external: true,  summary: "Search the web." },
  "browser.open":    { capability: "browser",   permission: "READ",   external: true,  summary: "Open a page and read it." },
  "browser.extract": { capability: "browser",   permission: "READ",   external: true,  summary: "Extract structured data from the open page." },
  "browser.fill":    { capability: "browser",   permission: "MODIFY", external: true,  summary: "Type into a field. Does not submit." },
  "browser.click":   { capability: "browser",   permission: "MODIFY", external: true,  summary: "Click a non-committing control." },
  "browser.submit":  { capability: "browser",   permission: "COMMIT", external: true,  summary: "Submit a form. Always confirmed." },

  "export.file":     { capability: "export",    permission: "CREATE", external: false, summary: "Write a representation out to a user-chosen path." },
};

export const specOf = (tool: Tool): ToolSpec => TOOL_SPECS[tool];

/**
 * Whether a tool can produce material that did not exist before.
 *
 * `external` is the honest proxy already in the table: a tool that never leaves the machine
 * is transforming something a person already has. Kept as its own named predicate because
 * "deterministic first, cheap model second, expensive generation last" is a rule several
 * layers enforce, and each of them should be asking the same question.
 */
export const isGenerativeTool = (tool: Tool): boolean => TOOL_SPECS[tool].external;
