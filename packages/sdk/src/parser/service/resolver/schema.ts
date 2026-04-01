import { z } from "zod";
import { AuthInvokerSchema } from "@/parser/service/auth-invoker/schema";
import { functionSchema } from "../common";

const TailorFieldTypeSchema = z.enum([
  "uuid",
  "string",
  "boolean",
  "integer",
  "float",
  "decimal",
  "enum",
  "date",
  "datetime",
  "time",
  "nested",
]);

export const QueryTypeSchema = z
  .union([z.literal("query"), z.literal("mutation")])
  .describe("GraphQL operation type");

const AllowedValueSchema = z.object({
  value: z.string().describe("The allowed value"),
  description: z.string().optional().describe("Description of the allowed value"),
});

const FieldMetadataSchema = z.object({
  required: z.boolean().optional().describe("Whether the field is required"),
  array: z.boolean().optional().describe("Whether the field is an array"),
  description: z.string().optional().describe("Field description"),
  allowedValues: z.array(AllowedValueSchema).optional().describe("Allowed values for enum fields"),
  hooks: z
    .object({
      create: functionSchema.optional().describe("Hook function called on creation"),
      update: functionSchema.optional().describe("Hook function called on update"),
    })
    .optional()
    .describe("Lifecycle hooks"),
  typeName: z.string().optional().describe("Type name for nested or enum fields"),
});

export const TailorFieldSchema = z.object({
  type: TailorFieldTypeSchema.describe("Field data type"),
  metadata: FieldMetadataSchema.describe("Field metadata configuration"),
  get fields() {
    return z.record(z.string(), TailorFieldSchema);
  },
});

export const ResolverSchema = z.object({
  operation: QueryTypeSchema.describe("GraphQL operation type (query or mutation)"),
  name: z.string().describe("Resolver name"),
  description: z.string().optional().describe("Resolver description"),
  input: z.record(z.string(), TailorFieldSchema).optional().describe("Input field definitions"),
  body: functionSchema.describe("Resolver implementation function"),
  output: TailorFieldSchema.describe("Output field definition"),
  publishEvents: z.boolean().optional().describe("Enable publishing events from this resolver"),
  authInvoker: AuthInvokerSchema.optional().describe("Machine user to execute this resolver as"),
});
