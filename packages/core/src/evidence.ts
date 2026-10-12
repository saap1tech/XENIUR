import {z} from "zod";
import {UuidSchema} from "./ids.js";

export const PassageCitationSchema=z.object({
  passageId:z.string().regex(/^[a-f0-9]{64}$/),sourceId:UuidSchema,sourceVersionId:UuidSchema,
  page:z.number().int().positive().nullable(),quote:z.string().trim().min(12).max(1200),
}).strict();
export type PassageCitation=z.infer<typeof PassageCitationSchema>;
export interface EvidencePassage {id:string;sourceId:string;sourceVersionId:string;page:number|null;start:number;end:number;text:string;}
export interface ResourceCoverage {sourceId:string;title:string;capturedPassages:number;selectedPassages:number;capturedPages:number;selectedPages:number[];partial:boolean;}
export interface EvidenceCoverage {query:string;resources:ResourceCoverage[];selectedCharacters:number;budgetCharacters:number;assessedAt:number;}
export interface EvidenceReview {target:string;state:"supports"|"uncertain"|"contradicts";note:string;at:number;objectId?:string;}
export interface JourneyRun {id:string;action:string;state:"running"|"succeeded"|"failed"|"cancelled"|"interrupted";startedAt:number;finishedAt:number|null;maximumUsd:number;actualUsd:number|null;usageKnown:boolean;
  /** Quotes the model wrote that were not word for word in the source, so they were left out. */
  removedQuotes?:number;}
export interface WorkOutcome {kind:"evidence_opened"|"evidence_reviewed"|"decision_revised"|"review_completed"|"exported"|"returned";at:number;}
