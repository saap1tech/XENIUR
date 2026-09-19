import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

export const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
}).strict();
export type ConstraintOption = z.infer<typeof OptionSchema>;

export const PlaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  x: z.number(),
  y: z.number(),
  district: z.string().default(""),
}).strict();
export type ConstraintPlace = z.infer<typeof PlaceSchema>;

const RangeConstraintSchema = z.object({
  kind: z.literal("range"),
  min: z.number(), max: z.number(), step: z.number().positive(), unit: z.string().min(1),
}).strict();

const EnumConstraintSchema = z.object({
  kind: z.literal("enum"),
  options: z.array(OptionSchema).min(2), multiple: z.boolean(),
}).strict();

const BooleanConstraintSchema = z.object({ kind: z.literal("boolean") }).strict();

const DateRangeConstraintSchema = z.object({
  kind: z.literal("date_range"), earliest: TimestampSchema, latest: TimestampSchema,
}).strict();

const LocationConstraintSchema = z.object({
  kind: z.literal("location"), places: z.array(PlaceSchema).min(1),
}).strict();

const PriorityConstraintSchema = z.object({
  kind: z.literal("priority"), dimensions: z.array(z.string().min(1)).min(2),
}).strict();

const QuantityConstraintSchema = z.object({
  kind: z.literal("quantity"),
  min: z.number().int(), max: z.number().int(), unit: z.string().min(1),
}).strict();

/** A first-class, versionable definition of a constraint. */
export const ConstraintSchema = z.discriminatedUnion("kind", [
  RangeConstraintSchema,
  EnumConstraintSchema,
  BooleanConstraintSchema,
  DateRangeConstraintSchema,
  LocationConstraintSchema,
  PriorityConstraintSchema,
  QuantityConstraintSchema,
]).superRefine((definition, context) => {
  if ((definition.kind === "range" || definition.kind === "quantity") && definition.max < definition.min) {
    context.addIssue({ code: "custom", path: ["max"], message: "max must be at least min" });
  }
  if (definition.kind === "date_range" && definition.latest < definition.earliest) {
    context.addIssue({ code: "custom", path: ["latest"], message: "latest must be at or after earliest" });
  }
});
export type Constraint = z.infer<typeof ConstraintSchema>;
export type ConstraintKind = Constraint["kind"];

export const DateRangeValueSchema = z.object({ start: TimestampSchema, end: TimestampSchema }).strict();
export const PriorityValueSchema = z.record(z.number().min(0).max(1));
export type ConstraintValue = number | string | string[] | boolean |
  z.infer<typeof DateRangeValueSchema> | Record<string, number>;

export const ConstraintRecordSchema = z.object({
  objectId: UuidSchema,
  definition: ConstraintSchema,
  value: z.unknown(),
  appliesTo: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type ConstraintRecord = Omit<z.infer<typeof ConstraintRecordSchema>, "value"> & {
  value: ConstraintValue;
};

/**
 * Validates a value against its own definition. This is deliberately dependent validation:
 * accepting a broad JSON value and checking it later would let invalid state reach history.
 */
export function parseConstraintValue(definition: Constraint, input: unknown): ConstraintValue {
  switch (definition.kind) {
    case "range": {
      const value = z.number().min(definition.min).max(definition.max).parse(input);
      const steps = (value - definition.min) / definition.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8) {
        throw new z.ZodError([{ code: "custom", path: [], message: `value must follow step ${definition.step}` }]);
      }
      return value;
    }
    case "quantity":
      return z.number().int().min(definition.min).max(definition.max).parse(input);
    case "enum": {
      const ids = new Set(definition.options.map((option) => option.id));
      if (definition.multiple) {
        const values = z.array(z.string()).min(1).parse(input);
        if (values.some((value) => !ids.has(value))) throw new z.ZodError([
          { code: "custom", path: [], message: "value must name a declared option" },
        ]);
        return values;
      }
      const value = z.string().parse(input);
      if (!ids.has(value)) throw new z.ZodError([
        { code: "custom", path: [], message: "value must name a declared option" },
      ]);
      return value;
    }
    case "boolean":
      return z.boolean().parse(input);
    case "date_range": {
      const value = DateRangeValueSchema.parse(input);
      if (value.start < definition.earliest || value.end > definition.latest || value.end < value.start) {
        throw new z.ZodError([{ code: "custom", path: [], message: "date range is outside its definition" }]);
      }
      return value;
    }
    case "location": {
      const value = z.string().parse(input);
      if (!definition.places.some((place) => place.id === value)) throw new z.ZodError([
        { code: "custom", path: [], message: "location must name a declared place" },
      ]);
      return value;
    }
    case "priority": {
      const value = PriorityValueSchema.parse(input);
      const declared = new Set(definition.dimensions);
      if (Object.keys(value).length !== declared.size || Object.keys(value).some((key) => !declared.has(key))) {
        throw new z.ZodError([{ code: "custom", path: [], message: "priority value must cover every declared dimension" }]);
      }
      return value;
    }
  }
}

export function parseConstraintRecord(input: unknown): ConstraintRecord {
  const record = ConstraintRecordSchema.parse(input);
  return { ...record, value: parseConstraintValue(record.definition, record.value) };
}
