import { z } from "zod";
import { AuthInvokerSchema } from "#/parser/service/auth/schema";
import { TailorFieldSchema } from "#/parser/service/field/schema";
import { functionSchema } from "../common";

export const QueryTypeSchema = z
  .union([z.literal("query"), z.literal("mutation")])
  .describe("GraphQL operation type");

const ResolverPermissionOperandSchema = z.union([
  z.object({ user: z.string() }).strict(),
  z.string(),
  z.boolean(),
]);

const ResolverPermissionOperatorSchema = z.union([z.literal("="), z.literal("!=")]);

const ResolverPermissionConditionSchema = z
  .tuple([
    ResolverPermissionOperandSchema,
    ResolverPermissionOperatorSchema,
    ResolverPermissionOperandSchema,
  ])
  .readonly();

const ResolverPermissionSchema = z.object({
  conditions: z.union([
    ResolverPermissionConditionSchema,
    z.array(ResolverPermissionConditionSchema).readonly(),
  ]),
  permit: z.boolean(),
  description: z.string().optional(),
});

export const ResolverAuthSchema = z
  .union([ResolverPermissionSchema, z.literal("public")])
  .describe(
    "Access requirement for this resolver, evaluated against the original caller " +
      '(unaffected by `authInvoker`) before `body` runs. "public" documents that anonymous ' +
      "callers are allowed. Omitted (default): unchanged, anonymous callers can reach the resolver",
  );

export const ResolverSchema = z.object({
  operation: QueryTypeSchema.describe("GraphQL operation type (query or mutation)"),
  name: z.string().describe("Resolver name"),
  description: z.string().optional().describe("Resolver description"),
  input: z.record(z.string(), TailorFieldSchema).optional().describe("Input field definitions"),
  body: functionSchema.describe("Resolver implementation function"),
  output: TailorFieldSchema.describe("Output field definition"),
  publishEvents: z.boolean().optional().describe("Enable publishing events from this resolver"),
  authInvoker: AuthInvokerSchema.optional().describe("Machine user to execute this resolver as"),
  auth: ResolverAuthSchema.optional(),
});
