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

const operandTypeMismatch = (
  userOperand: z.infer<typeof ResolverPermissionOperandSchema>,
  otherOperand: z.infer<typeof ResolverPermissionOperandSchema>,
) => {
  if (typeof userOperand !== "object") {
    return undefined;
  }
  const expected = KNOWN_USER_OPERAND_TYPES[userOperand.user];
  if (
    expected === undefined ||
    typeof otherOperand === "object" ||
    typeof otherOperand === expected
  ) {
    return undefined;
  }
  return { key: userOperand.user, expected };
};

const ResolverPermissionConditionSchema = z
  .tuple([
    ResolverPermissionOperandSchema,
    ResolverPermissionOperatorSchema,
    ResolverPermissionOperandSchema,
  ])
  .refine(
    ([left, , right]) => isUserOperand(left) !== isUserOperand(right),
    "Resolver permission condition must reference a `user` operand on exactly one side " +
      "(comparing two `user` operands to each other can match on `undefined === undefined`)",
  )
  .superRefine(([left, , right], ctx) => {
    for (const mismatch of [operandTypeMismatch(left, right), operandTypeMismatch(right, left)]) {
      if (mismatch) {
        ctx.addIssue({
          code: "custom",
          message: `\`${mismatch.key}\` must compare to a ${mismatch.expected}`,
        });
      }
    }
  })
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
      .refine(
        (policies) => policies.some((policy) => policy.permit === true),
        "Resolver permission must include at least one `permit: true` policy — a policy array " +
          "with only `permit: false` policies still lets any caller through by simply not " +
          "authenticating, since none of the deny conditions apply to a caller with no user " +
          "attributes at all",
      )
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
