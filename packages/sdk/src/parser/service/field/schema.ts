import { z } from "zod";
import { TailorFieldTypeSchema } from "../field-types";
import { DBFieldMetadataSchema } from "../tailordb/schema";

// Resolver input/output and machine user attributes also take TailorDB fields.
const FieldMetadataSchema = DBFieldMetadataSchema.extend({
  as: z
    .enum(["string", "date", "temporal", "default"])
    .optional()
    .describe('Date value representation; "default" follows defaultDateRepresentation'),
});

// strip unknown keys
export const TailorFieldSchema = z.object({
  type: TailorFieldTypeSchema.describe("Field data type"),
  metadata: FieldMetadataSchema.describe("Field metadata configuration"),
  get fields() {
    return z.record(z.string(), TailorFieldSchema);
  },
});
