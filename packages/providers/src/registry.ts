import type { Tool } from "@xeniur/core";
import type { Provider } from "./types.js";
import { sharpProvider } from "./local/sharp.js";
import { ffmpegProvider } from "./local/ffmpeg.js";
import { blenderProvider } from "./local/blender.js";
import { templateProvider } from "./local/template.js";
import { dockerProvider } from "./local/docker.js";
import { importProvider } from "./local/import.js";
import { mockImageProvider } from "./mock/image.js";
import { mockMeshProvider } from "./mock/mesh.js";
import { mockVideoProvider } from "./mock/video.js";
import { openaiImageProvider, meshyProvider, runwayProvider } from "./cloud/stubs.js";

export const ALL_PROVIDERS: readonly Provider[] = [
  // Deterministic and local: preferred for everything they can do.
  importProvider, sharpProvider, ffmpegProvider, blenderProvider, templateProvider, dockerProvider,
  // Mocks: real artefacts, zero cost, always stamped "mock".
  mockImageProvider, mockMeshProvider, mockVideoProvider,
  // Generative: declared, priced, disabled.
  openaiImageProvider, meshyProvider, runwayProvider,
];

export class ProviderRegistry {
  private readonly byId = new Map<string, Provider>();

  constructor(providers: readonly Provider[] = ALL_PROVIDERS) {
    for (const p of providers) this.byId.set(p.id, p);
  }

  get(id: string): Provider | undefined { return this.byId.get(id); }
  register(provider: Provider): void { this.byId.set(provider.id, provider); }
  all(): Provider[] { return [...this.byId.values()]; }
  supporting(tool: Tool): Provider[] {
    return this.all().filter((p) => p.tools.includes(tool));
  }
}
