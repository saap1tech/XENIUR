import type { ActionPlan, Tool } from "@xeniur/core";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

interface Rule { tool: Tool; match: RegExp; args?: (utterance: string) => Record<string, unknown>; }

/**
 * Ordered most specific first: "make it printable" is an export, not a 3D generation,
 * even though both mention a model.
 */
const RULES: Rule[] = [
  { tool: "3d.export", match: /\b(stl|printable|print it|3d print|slicer)\b/i, args: () => ({ format: "stl" }) },
  { tool: "3d.process", match: /\b(rescale|scale the mesh|clean(?: up)? the mesh|smooth|game[- ]ready)\b/i },
  { tool: "3d.generate", match: /\b(3d|three[- ]d|mesh|model it|sculpt)\b/i },
  { tool: "image.transform", match: /\b(resize|crop|rotate|smaller|bigger|grayscale|greyscale|tint|flip)\b/i },
  { tool: "video.edit", match: /\b(trim|cut the video|shorten the clip|subtitle)\b/i },
  { tool: "video.generate", match: /\b(video|clip|animate|animation)\b/i },
  { tool: "code.scaffold", match: /\b(game|app|website|web page|prototype|code)\b/i },
  { tool: "browser.submit", match: /\b(book|order|buy|reserve|checkout|submit)\b/i },
  { tool: "browser.search", match: /\b(search|find|look up|research)\b/i },
  { tool: "doc.write", match: /\b(write|draft|contract|document|deck|summary)\b/i },
  { tool: "object.move", match: /\b(move|drag|put it)\b/i },
  { tool: "image.generate", match: /\b(draw|picture|image|illustration|make (?:me )?an?)\b/i },
];

/**
 * A deterministic keyword classifier standing in for a routing model.
 *
 * It exists so the whole application is exercisable with no key and no cost. It is a
 * stub, not intelligence: it is stamped MOCK in the UI and "mock" in the graph, and it
 * is never presented as model output. Because it implements LlmClient, it exercises
 * exactly the same validation and repair path a real model does.
 */
export class MockLlmClient implements LlmClient {
  readonly id = "mock";
  readonly model = "mock.brain/v1";

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const utterance = request.user.split("The person said:").pop()?.trim() ?? "";
    const objects = [...request.user.matchAll(/id=([0-9a-f-]{36})/gi)]
      .map((m) => m[1]!)
      .filter((id, i, all) => all.indexOf(id) === i);

    const rule = RULES.find((r) => r.match.test(utterance));
    const tool: Tool = rule?.tool ?? "image.generate";

    const plan: ActionPlan = {
      intent: utterance.slice(0, 80) || "do something",
      // Object-creating tools start fresh; everything else acts on what is selected.
      objects: tool === "object.move" || objects.length === 0 ? objects.slice(0, 1) : objects.slice(0, 1),
      tool,
      args: { ...defaultArgs(tool, utterance), ...(rule?.args?.(utterance) ?? {}) },
      confirmation: tool === "browser.submit",
      rationale: `matched "${rule?.match.source ?? "fallback"}" — deterministic mock classifier`,
    };
    return {
      text: JSON.stringify(plan),
      inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
      outputTokens: 0, model: this.model,
    };
  }
}

function defaultArgs(tool: Tool, utterance: string): Record<string, unknown> {
  switch (tool) {
    case "image.generate": return { prompt: utterance, width: 768, height: 768 };
    case "3d.generate": return { prompt: utterance, targetHeight: 3 };
    case "video.generate": return { prompt: utterance, durationSeconds: 3 };
    case "code.scaffold": return { title: utterance.slice(0, 60) || "XENIUR App" };
    case "doc.write": return { prompt: utterance };
    case "browser.search": return { query: utterance };
    default: return {};
  }
}

/** A client that always returns exactly what you give it. For testing the repair path. */
export class ScriptedLlmClient implements LlmClient {
  readonly id = "scripted";
  readonly model = "scripted";
  private index = 0;
  constructor(private readonly replies: string[]) {}
  async complete(): Promise<LlmResponse> {
    const text = this.replies[Math.min(this.index, this.replies.length - 1)] ?? "";
    this.index += 1;
    return { text, inputTokens: 0, outputTokens: 0, model: this.model };
  }
  get calls(): number { return this.index; }
}
