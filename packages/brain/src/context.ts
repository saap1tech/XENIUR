import type { ObjectState, Representation, Task, World } from "@xeniur/core";
import { fenceUntrusted, isUntrusted, type UntrustedContent } from "@xeniur/core";

export interface BrainContext {
  world: Pick<World, "id" | "title" | "emoji">;
  /** Only what the person has selected. Never the whole World. */
  selected: Array<{ state: ObjectState; representations: Representation[] }>;
  activeTasks: Array<Pick<Task, "id" | "title" | "status">>;
  /** Anything read from a page, file or third party, carried in its wrapper. */
  untrusted?: UntrustedContent[];
}

const MAX_REPS_PER_OBJECT = 6;
const MAX_TASKS = 8;

/**
 * Builds the variable half of the prompt.
 *
 * It sends the selected objects' state, a one-line world summary and a short task list —
 * deliberately not the entire World. Sending everything is how a cheap router model
 * becomes an expensive one.
 */
export function renderContext(ctx: BrainContext): string {
  const parts: string[] = [`World: ${ctx.world.emoji} ${ctx.world.title} (${ctx.world.id})`];

  if (ctx.selected.length === 0) {
    parts.push("Selected: nothing.");
  } else {
    parts.push("Selected objects:");
    for (const { state, representations } of ctx.selected) {
      const { title, semanticType } = state.properties;
      parts.push(`- ${title} [${semanticType}] id=${state.object.id} v${state.seq}`);
      if (state.forms.length > 0) {
        parts.push(`    current forms: ${state.forms.map((f) => f.role).join(", ")}`);
      }
      const recent = representations.slice(-MAX_REPS_PER_OBJECT);
      for (const r of recent) {
        parts.push(`    ${r.modality}/${r.format} id=${r.id} provenance=${r.provenance}${r.provider ? ` via ${r.provider}` : ""}`);
      }
      if (representations.length > recent.length) {
        parts.push(`    (+${representations.length - recent.length} older representations, summarised away)`);
      }
    }
  }

  const tasks = ctx.activeTasks.slice(0, MAX_TASKS);
  if (tasks.length > 0) {
    parts.push("Active tasks:");
    for (const t of tasks) parts.push(`- ${t.title} — ${t.status}`);
  }

  for (const u of ctx.untrusted ?? []) {
    if (isUntrusted(u)) parts.push(fenceUntrusted(u));
  }
  return parts.join("\n");
}

export const renderRequest = (ctx: BrainContext, utterance: string): string =>
  `${renderContext(ctx)}\n\nThe person said: ${utterance}`;
