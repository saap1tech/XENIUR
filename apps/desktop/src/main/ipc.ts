import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { extractCandidates } from "@xeniur/sensemaking";
import { z } from "zod";
import { UuidSchema, type IntentResult, type WorldSnapshot } from "@xeniur/core";
import { InvalidPlanError } from "@xeniur/brain";
import type { Services } from "./services.js";
import { assertTrustedSender, UntrustedSenderError } from "./security.js";

const Uuid = z.object({ id: UuidSchema });
const Rect = z.object({
  viewId: z.string().min(1),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});

/**
 * Every privileged channel, with its payload schema. There is one entry per capability
 * and no generic passthrough: the preload can only expose what is listed here, so the
 * allowlist is the API rather than a filter over a wider one.
 */
const SCHEMAS = {
  "worlds:list": z.undefined(),
  "worlds:create": z.object({ title: z.string().min(1), emoji: z.string().min(1).max(8), summary: z.string().optional() }),
  "worlds:open": Uuid,
  "objects:get": Uuid,
  "objects:representations": Uuid,
  "objects:lineage": Uuid,
  "objects:undo": Uuid,
  "objects:redo": Uuid,
  "intent:submit": z.object({
    worldId: UuidSchema, utterance: z.string().min(1).max(2000),
    selection: z.array(UuidSchema).max(32).optional(),
  }),
  "tasks:active": z.undefined(),
  "tasks:approve": Uuid,
  "tasks:reject": Uuid,
  "tasks:cancel": Uuid,
  "browser:open": z.object({ url: z.string().url().refine((u) => /^https?:/.test(u), "only http(s)") }),
  "browser:navigate": z.object({ viewId: z.string().min(1), url: z.string().url() }),
  "browser:setBounds": Rect,
  "browser:close": z.object({ viewId: z.string().min(1) }),
  "code:files": Uuid,
  "code:run": Uuid,
  "code:stop": Uuid,
  "system:info": z.undefined(),

  /* Living Objects */
  "living:detail": Uuid,
  "living:validate": Uuid,
  "living:rebuild": z.object({ id: UuidSchema, includeGeneration: z.boolean().default(false) }),
  "living:release": z.object({ id: UuidSchema, profileId: z.string().min(1), note: z.string().max(500).optional() }),
  "living:switchBranch": z.object({ id: UuidSchema, branchId: UuidSchema }),
  "living:import": z.object({
    paths: z.array(z.string().min(1)).min(1).max(32),
    worldId: UuidSchema,
    objectId: UuidSchema.nullable().optional(),
  }),
  "living:export": Uuid,
  "living:impact": Uuid,

  /* Sensemaking */
  "sense:map": Uuid,
  "sense:friction": Uuid,
  "sense:dismissFriction": z.object({ id: UuidSchema, reason: z.string().max(500).optional() }),
  "sense:capture": z.object({
    worldId: UuidSchema,
    kind: z.enum(["article", "video", "podcast", "paper", "note", "conversation", "screenshot", "clip", "book"]),
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(200_000),
    url: z.string().url().optional(),
    author: z.string().max(200).optional(),
  }),
  "sense:observe": z.object({ worldId: UuidSchema, text: z.string().min(1).max(4000), about: UuidSchema.optional() }),
  "sense:sort": z.object({ id: UuidSchema, lane: z.enum(["keep", "question", "connect", "test", "build", "ignore"]) }),
  "sense:rate": z.object({ id: UuidSchema, confidence: z.number().min(0).max(1).nullable() }),
  "sense:link": z.object({
    fromObjectId: UuidSchema, toObjectId: UuidSchema,
    relation: z.enum(["supports", "contradicts", "example_of", "asks_about", "same_as", "derived_from"]),
    note: z.string().max(500).optional(),
  }),

  /* Decisions */
  "decisions:list": Uuid,
  "decisions:get": Uuid,
  "decisions:create": z.object({
    worldId: UuidSchema,
    question: z.string().min(1).max(500),
    options: z.array(z.object({
      key: z.string().min(1).max(60),
      label: z.string().min(1).max(200),
      note: z.string().max(500).default(""),
    })).max(12).default([]),
    chosenOption: z.string().max(60).nullable().optional(),
    rationale: z.string().max(4000).optional(),
  }),
  "decisions:cite": z.object({
    id: UuidSchema,
    sourceVersionId: UuidSchema.nullable().optional(),
    atomObjectId: UuidSchema.nullable().optional(),
    relation: z.enum(["supports", "contradicts", "informed_by"]).default("informed_by"),
    note: z.string().max(500).default(""),
  }),
  "decisions:assume": z.object({
    id: UuidSchema,
    text: z.string().min(1).max(1000),
    reviewTrigger: z.string().max(500).default(""),
  }),
  "decisions:accept": Uuid,
  "decisions:reaffirm": Uuid,
  "decisions:passage": Uuid,
  "decisions:influence": z.object({ id: UuidSchema, releaseId: UuidSchema.optional() }),
} as const;

export type Channel = keyof typeof SCHEMAS;
export const CHANNELS = Object.keys(SCHEMAS) as Channel[];

export function registerIpc(services: Services): void {
  const handlers: { [K in Channel]: (args: z.infer<(typeof SCHEMAS)[K]>) => unknown } = {
    "worlds:list": () => services.graph.listWorlds(),
    "worlds:create": (a) => services.graph.createWorld(a),
    "worlds:open": ({ id }): WorldSnapshot | null => {
      const world = services.graph.getWorld(id);
      if (!world) return null;
      services.graph.touchWorld(id);
      const states = services.graph.listStates(id);
      return {
        world, states,
        representations: states.flatMap((s) => services.graph.listRepresentations(s.object.id)),
        tasks: services.queue.tasks.list(id),
        scene: null,
      };
    },
    "objects:get": ({ id }) => services.graph.currentState(id),
    "objects:representations": ({ id }) => services.graph.listRepresentations(id),
    "objects:lineage": ({ id }) => services.lineage(id),
    "objects:undo": ({ id }) => services.graph.undo(id),
    "objects:redo": ({ id }) => services.graph.redo(id),

    "intent:submit": async ({ worldId, utterance, selection }): Promise<IntentResult> => {
      const world = services.graph.getWorld(worldId);
      if (!world) return { accepted: false, taskId: null, plan: null, error: "no such world" };

      const selected = (selection ?? []).map((id) => services.graph.currentState(id))
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((state) => ({ state, representations: services.graph.listRepresentations(state.object.id) }));

      try {
        const { plan } = await services.brain.plan(utterance, {
          world: { id: world.id, title: world.title, emoji: world.emoji },
          selected,
          activeTasks: services.queue.tasks.active().map((t) => ({ id: t.id, title: t.title, status: t.status })),
        });

        // Feed the *current* form of the selected object in as the source — resolved
        // through the head version, so an undo actually changes what gets transformed.
        const objectId = plan.objects[0] ?? selected[0]?.state.object.id;
        const state = objectId ? services.graph.currentState(objectId) : null;
        const headForm = state?.forms[state.forms.length - 1];
        const head = headForm ? services.graph.getRepresentation(headForm.representationId) : undefined;

        const task = services.queue.enqueue({
          worldId, title: plan.intent, tool: plan.tool,
          payload: {
            plan, ...(objectId ? { objectId } : {}),
            ...(head ? { inputs: [{ representationId: head.id, role: "source" }] } : {}),
          },
        });
        return { accepted: true, taskId: task.id, plan: { intent: plan.intent, tool: plan.tool, objects: plan.objects } };
      } catch (err) {
        // A plan that will not validate never becomes a task.
        const error = err instanceof InvalidPlanError
          ? "I could not turn that into a plan I trust. Try saying it another way."
          : err instanceof Error ? err.message : String(err);
        return { accepted: false, taskId: null, plan: null, error };
      }
    },

    "tasks:active": () => services.queue.tasks.active(),
    "tasks:approve": ({ id }) => { services.queue.approve(id); },
    "tasks:reject": ({ id }) => { services.queue.reject(id); },
    "tasks:cancel": ({ id }) => { services.queue.cancel(id); },

    "browser:open": ({ url }) => services.browser.open(url),
    "browser:navigate": ({ viewId, url }) => { services.browser.navigate(viewId, url); },
    "browser:setBounds": ({ viewId, rect }) => { services.browser.setBounds(viewId, rect); },
    "browser:close": ({ viewId }) => { services.browser.close(viewId); },

    "code:files": ({ id }) => services.preview.files(id),
    "code:run": ({ id }) => {
      const rep = services.graph.listRepresentations(id).filter((r) => r.modality === "code").at(-1);
      if (!rep?.blobHash) throw new Error("this object has no project to run");
      services.preview.load(id, services.graph.readBlob(rep.blobHash));
      return services.preview.run(id);
    },
    "code:stop": ({ id }) => { services.preview.stop(id); },

    "system:info": () => services.systemInfo(),

    /* ------------------------------------------------------ Living Objects */

    "living:detail": ({ id }) => services.detailOf(id),

    "living:validate": async ({ id }) => {
      const summary = await services.validation.validate(id);
      return summary.checks;
    },

    "living:rebuild": async ({ id, includeGeneration }) => {
      const object = services.graph.getObject(id);
      if (!object) return null;
      // Deterministic rebuilds need no permission; generation does, and gets one bound to
      // the plan rather than a blanket yes granted by the fact that a button was clicked.
      await services.rebuild.run(id, { worldId: object.worldId, includeGeneration });
      // Checks are re-run straight away: a rebuilt form with stale evidence beside it is
      // exactly the kind of quiet wrongness readiness exists to prevent.
      await services.validation.validate(id);
      return services.detailOf(id);
    },

    "living:release": ({ id, profileId, note }) => {
      try {
        return services.readiness.approve({ objectId: id, profileId, note: note ?? null });
      } catch (err) {
        // NotReady is an answer, not a crash: the renderer shows what is missing.
        if (err instanceof Error && "blockers" in err) return null;
        throw err;
      }
    },

    "living:switchBranch": ({ id, branchId }) => services.graph.switchBranch(id, branchId),

    "living:impact": ({ id }) => services.impactOf(id),

    /* ----------------------------------------------------------- Decisions */

    "decisions:list": ({ id }) => services.graph.decisions.list(id),
    "decisions:get": ({ id }) => services.graph.decisions.detail(id),

    "decisions:create": ({ worldId, question, options, chosenOption, rationale }) => {
      const created = services.graph.decisions.create({
        worldId, question,
        options: options.map((o) => ({ key: o.key, label: o.label, note: o.note })),
        chosenOption: chosenOption ?? null, rationale: rationale ?? "",
      });
      return services.graph.decisions.detail(created.objectId);
    },

    "decisions:cite": ({ id, sourceVersionId, atomObjectId, relation, note }) => {
      services.graph.decisions.cite(id, {
        sourceVersionId: sourceVersionId ?? null,
        atomObjectId: atomObjectId ?? null,
        atomVersionId: null, relation, note,
      });
      return services.graph.decisions.detail(id);
    },

    "decisions:assume": ({ id, text, reviewTrigger }) => {
      services.graph.decisions.assume(id, { text, reviewTrigger });
      return services.graph.decisions.detail(id);
    },

    // Accepting renders the brief deterministically. No model is involved, so this needs
    // no permission beyond being in the app.
    "decisions:accept": ({ id }) => services.graph.decisions.accept(id),
    "decisions:reaffirm": ({ id }) => {
      services.graph.decisions.reaffirm(id);
      return services.graph.decisions.detail(id);
    },

    "decisions:passage": ({ id }) => services.passageOf(id),
    "decisions:influence": ({ id, releaseId }) =>
      services.graph.decisions.influenceOn(id, releaseId),

    "living:import": async ({ paths, worldId, objectId }) => {
      const out = [];
      for (const path of paths) {
        const target = objectId ?? services.graph.createObject({
          worldId, semanticType: "file",
          title: path.split("/").pop() ?? "Imported file",
        }).object.id;

        const result = await services.router.execute(
          { intent: `import ${path.split("/").pop()}`, objects: [target], tool: "import.file",
            args: { path }, confirmation: false },
          { worldId, objectId: target, formRoles: ["source.primary", "model.mesh"], label: "imported" },
        );
        if (result.state) out.push(result.state);
      }
      return out;
    },

    "living:export": async ({ id }) => {
      const state = services.graph.currentState(id);
      if (!state) return null;
      const safe = state.properties.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const outPath = join(app.getPath("downloads"), `${safe || "object"}.xeniur`);
      return services.packageOf(id, outPath);
    },

    /* --------------------------------------------------------- Sensemaking */

    "sense:map": ({ id }) => services.thinkingMap(id),
    "sense:friction": ({ id }) => services.sense.friction(id),
    "sense:dismissFriction": ({ id, reason }) => { services.sense.dismissFriction(id, reason ?? ""); },

    "sense:capture": ({ worldId, kind, title, text, url, author }) => {
      const source = services.sense.recordSource({
        worldId, kind, title, url: url ?? null, author: author ?? null,
      });
      // Heuristic candidates, offered as such. Nothing is written in as understood.
      const atoms = services.sense.acceptCandidates(worldId, source.id, extractCandidates(text));
      return { sourceId: source.id, atoms };
    },

    "sense:observe": ({ worldId, text, about }) =>
      services.sense.observe(worldId, text, about ? { about } : {}),
    "sense:sort": ({ id, lane }) => services.sense.sort(id, lane),
    "sense:rate": ({ id, confidence }) => services.sense.rate(id, confidence),
    "sense:link": (input) => {
      services.sense.link({
        fromObjectId: input.fromObjectId, toObjectId: input.toObjectId,
        relation: input.relation, note: input.note ?? null,
      });
    },
  };

  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      try {
        // Who is asking, then what are they asking. Both, in that order, every time.
        assertTrustedSender(event);
        const args = SCHEMAS[channel].parse(payload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one cast at the boundary
        return await (handlers[channel] as (a: any) => unknown)(args);
      } catch (err) {
        if (err instanceof UntrustedSenderError) {
          console.error(`[XENIUR] ${channel}: ${err.message} (origin ${err.origin})`);
          throw new Error("refused");           // never echo internals to a renderer
        }
        if (err instanceof z.ZodError) {
          console.error(`[XENIUR] ${channel}: invalid payload — ${err.issues.map((i) => i.message).join("; ")}`);
          throw new Error("invalid request");
        }
        throw err;
      }
    });
  }
}
