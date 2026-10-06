import { z } from "zod";
import { StepOutputSchema } from "./work-path.js";
import { UuidSchema } from "./ids.js";
import {PassageCitationSchema} from "./evidence.js";

export const JourneyKindSchema = z.enum(["review", "document", "lesson", "campaign", "plan", "software", "experiment", "prototype", "script", "brand", "scientific_figure", "marketing_page", "product_listing", "storefront", "business", "decision", "travel", "custom"]);
export type JourneyKind = z.infer<typeof JourneyKindSchema>;
export const JourneyStageSchema = z.enum(["materials", "summary", "outline", "palette", "font", "layout", "make", "review", "path", "steps"]);
export type JourneyStage = z.infer<typeof JourneyStageSchema>;
const text = z.string().trim().min(1).max(8000);
export const ReportSchema = z.object({ title: z.string().max(160), summary: z.string().max(1400),
  findings: z.array(z.object({ text: z.string().max(450), sourceIds: z.array(UuidSchema).max(128), citations:z.array(PassageCitationSchema).max(12).optional() })).max(5),
  gaps: z.array(z.string().max(300)).max(3), illustration: z.string().max(1600),
  palettes: z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]+$/).max(30), name: z.string().max(50),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3) })).min(2).max(3),
}).strict();
export type JourneyReport = z.infer<typeof ReportSchema>;
const SectionSchema = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/).max(40), title: z.string().max(150),
  purpose: z.string().max(300), children: z.array(z.object({ title: z.string().max(150),
    children: z.array(z.string().max(150)).max(6) })).max(8) });
export const OutlineSchema = z.object({ title: z.string().max(160), sections: z.array(SectionSchema).min(1).max(12) }).strict();
export type JourneyOutline = z.infer<typeof OutlineSchema>;
export const DraftSchema = z.object({ title: z.string().max(160), abstract: z.string().max(1800),
  sections: z.array(z.object({ title: z.string().max(160), level: z.number().int().min(1).max(3),
    paragraphs: z.array(text).max(15), sourceIds: z.array(UuidSchema).max(128),citations:z.array(PassageCitationSchema).max(12).optional() })).min(1).max(40),
  tables: z.array(z.object({ title: z.string().max(150), columns: z.array(z.string().max(100)).min(1).max(6),
    rows: z.array(z.array(z.string().max(350)).max(6)).max(20), sourceIds: z.array(UuidSchema).max(128),citations:z.array(PassageCitationSchema).max(12).optional() })).max(5),
  figureIdeas: z.array(z.object({ prompt: z.string().max(1600), caption: z.string().max(400), sourceIds: z.array(UuidSchema).max(16) })).max(3),
  sourceFigureIdeas: z.array(z.object({ sourceId: UuidSchema, page: z.number().int().min(1).max(2000), caption: z.string().max(400) })).max(3).default([]),
  limitations: z.array(z.string().max(500)).max(8),
}).strict();
export type JourneyDraft = z.infer<typeof DraftSchema>;
export interface JourneyResource { id: string; title: string; url: string | null; sourceId: string; sourceVersionId: string;
  objectId: string; textLength: number; partial: boolean; rights: "unknown" | "permitted" | "restricted";
  blobHash: string | null; pages: number; extraction?:{pagesRead:number;ocrPages:number;unreadablePages:number[]}; }
export interface JourneySuggestion { id: string; title: string; url: string; excerpt: string;
  state: "pending" | "accepted" | "rejected"; decisionId: string | null; }
export interface JourneyFigure { id: string; blobHash: string; caption: string; origin: "generated" | "source";
  sourceId: string | null; page: number | null; objectId: string; sourceIds: string[]; }
export const JourneyBriefSchema=z.object({topic:z.string().trim().min(2).max(240),audience:z.string().max(160),notes:z.string().max(2000),language:z.string().trim().min(1).max(60),aspect:z.enum(["16:9","9:16","1:1"]).optional(),seconds:z.number().int().min(10).max(1800).optional()}).strict();
export type JourneyBrief=z.infer<typeof JourneyBriefSchema>;
export interface Journey {
  coverage?:import("./evidence.js").EvidenceCoverage;
  evidenceReviews?:import("./evidence.js").EvidenceReview[];
  outcomes?:import("./evidence.js").WorkOutcome[];
  brief?:JourneyBrief;
  flow?: import("./work-path.js").WorkPath;
  id: string; versionId: string; worldId: string; goalId: string; kind: JourneyKind; stage: JourneyStage;
  resources: JourneyResource[]; suggestions: JourneySuggestion[]; report: JourneyReport | null; outline: JourneyOutline | null;
  draft: JourneyDraft | null; figureIds: JourneyFigure[]; reportObjectId: string | null; outlineObjectId: string | null;
  draftObjectId: string | null; illustration: string | null;
  choices: { palette: string | null; font: string | null; layout: string | null };
  decisions: Array<{ stage: string; objectId: string; versionId: string }>;
  feedbackCount: number; reviewed: boolean; updatedAt: number;
}
export const JourneyCommandSchema = z.object({ worldId: UuidSchema, versionId: UuidSchema,
  action: z.enum(["search", "resource_accept", "resource_reject", "remove_resource", "summarize", "illustrate", "feedback", "approve_summary", "outline", "edit_outline", "approve_outline", "choose_palette", "choose_font", "choose_layout", "draft", "figure", "edit_draft", "review", "design_path", "approve_path", "begin_path", "run_step", "approve_step", "reopen_step", "record_step", "edit_step", "save_brief", "scene_image", "use_design_defaults", "review_evidence"]),
  evidenceState:z.enum(["supports","uncertain","contradicts"]).optional(),
  id: z.string().max(160).optional(), text: z.string().max(8000).optional(),
  brief:JourneyBriefSchema.optional(),
  stepOutput: StepOutputSchema.optional(),
  maximumUsd: z.number().nonnegative().max(5).optional(),
}).strict();
export type JourneyCommand = z.infer<typeof JourneyCommandSchema>;
export interface JourneyQuote { action: string; maximumUsd: number; model: string; sends: string; coverage?:import("./evidence.js").EvidenceCoverage; }
export const JOURNEY_FONTS = [
  { id: "cochineal", name: "Cochineal", file: "Cochineal-Roman.otf", bold: "Cochineal-Bold.otf", italic: "Cochineal-Italic.otf", description: "Warm · literary" },
  { id: "erewhon", name: "Erewhon", file: "Erewhon-Regular.otf", bold: "Erewhon-Bold.otf", italic: "Erewhon-Italic.otf", description: "Clear · scholarly" },
  { id: "pagella", name: "TeX Gyre Pagella", file: "texgyrepagella-regular.otf", bold: "texgyrepagella-bold.otf", italic: "texgyrepagella-italic.otf", description: "Open · composed" },
  { id: "schola", name: "TeX Gyre Schola", file: "texgyreschola-regular.otf", bold: "texgyreschola-bold.otf", italic: "texgyreschola-italic.otf", description: "Sturdy · readable" },
] as const;
export const JOURNEY_LAYOUTS = [{ id: "field", name: "Field notes" }, { id: "journal", name: "Journal" }, { id: "atlas", name: "Atlas" }, { id: "essay", name: "Essay" }] as const;
