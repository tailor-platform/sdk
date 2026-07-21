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

const isUserOperand = (operand: z.infer<typeof ResolverPermissionOperandSchema>) =>
  typeof operand === "object";

// Fixed `user` keys have a known value type; arbitrary user attributes don't
// (their declared type lives in the configure-layer generic, not here), so
// only these two are checked against the operand they're compared to.
const KNOWN_USER_OPERAND_TYPES: Record<string, "string" | "boolean"> = {
  _loggedIn: "boolean",
  id: "string",
};

const isOperandTypeMismatch = (
  userOperand: z.infer<typeof ResolverPermissionOperandSchema>,
  otherOperand: z.infer<typeof ResolverPermissionOperandSchema>,
) => {
  if (typeof userOperand !== "object") {
    return false;
  }
  const expected = KNOWN_USER_OPERAND_TYPES[userOperand.user];
  return (
    expected !== undefined && typeof otherOperand !== "object" && typeof otherOperand !== expected
  );
};

const ResolverPermissionConditionSchema = z
  .tuple([
    ResolverPermissionOperandSchema,
    ResolverPermissionOperatorSchema,
    ResolverPermissionOperandSchema,
  ])
  .refine(
    ([left, , right]) => isUserOperand(left) || isUserOperand(right),
    "Resolver permission condition must reference a `user` operand on at least one side",
  )
  .refine(
    ([left, , right]) => !isOperandTypeMismatch(left, right) && !isOperandTypeMismatch(right, left),
    '`{ user: "_loggedIn" }` must compare to a boolean and `{ user: "id" }` must compare to a string',
  )
  .readonly();

const ResolverPermissionPolicySchema = z.object({
  conditions: z.union([
    ResolverPermissionConditionSchema,
    z
      .array(ResolverPermissionConditionSchema)
      .min(1, "Resolver permission policy must have at least one condition")
      .readonly(),
  ]),
  permit: z.boolean(),
  description: z
    .string()
    .optional()
    .describe("Reason recorded for this policy, used in the access-denied error message"),
});

export const ResolverPermissionSchema = z
  .union([
    z
      .array(ResolverPermissionPolicySchema)
      .min(1, "Resolver permission must have at least one policy")
      .readonly(),
    z.literal("allowAnonymous"),
  ])
  .describe(
    "Access requirement for this resolver, evaluated against the original caller " +
      '(unaffected by `authInvoker`) before `body` runs. "allowAnonymous" documents that ' +
      "anonymous callers are allowed. Omitted (default): unchanged, anonymous callers can " +
      "reach the resolver",
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
  permission: ResolverPermissionSchema.optional(),
});
