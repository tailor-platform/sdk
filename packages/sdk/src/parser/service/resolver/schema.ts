import * as v from "valibot";
import { AuthInvokerSchema } from "#/parser/service/auth/schema";
import { TailorFieldSchema } from "#/parser/service/field/schema";
import { functionSchema } from "../common";

export const QueryTypeSchema = v.pipe(
  v.union([v.literal("query"), v.literal("mutation")]),
  v.description("GraphQL operation type"),
);

const ResolverPermissionOperandSchema = v.union([
  v.strictObject({ user: v.string() }),
  v.string(),
  v.boolean(),
]);

const ResolverPermissionOperatorSchema = v.union([v.literal("="), v.literal("!=")]);

const isUserOperand = (operand: v.InferOutput<typeof ResolverPermissionOperandSchema>) =>
  typeof operand === "object";

// Fixed `user` keys have a known value type; arbitrary user attributes don't
// (their declared type lives in the configure-layer generic, not here), so
// only these two are checked against the operand they're compared to.
const KNOWN_USER_OPERAND_TYPES: Record<string, "string" | "boolean"> = {
  _loggedIn: "boolean",
  id: "string",
};

const operandTypeMismatch = (
  userOperand: v.InferOutput<typeof ResolverPermissionOperandSchema>,
  otherOperand: v.InferOutput<typeof ResolverPermissionOperandSchema>,
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

const ResolverPermissionConditionSchema = v.pipe(
  v.tuple([
    ResolverPermissionOperandSchema,
    ResolverPermissionOperatorSchema,
    ResolverPermissionOperandSchema,
  ]),
  v.check(
    ([left, , right]) => isUserOperand(left) !== isUserOperand(right),
    "Resolver permission condition must reference a `user` operand on exactly one side " +
      "(comparing two `user` operands to each other can match on `undefined === undefined`)",
  ),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) {
      return;
    }
    const [left, , right] = dataset.value;
    for (const mismatch of [operandTypeMismatch(left, right), operandTypeMismatch(right, left)]) {
      if (mismatch) {
        addIssue({ message: `\`${mismatch.key}\` must compare to a ${mismatch.expected}` });
      }
    }
  }),
  v.readonly(),
);

const ResolverPermissionPolicySchema = v.strictObject({
  conditions: v.union([
    ResolverPermissionConditionSchema,
    v.pipe(
      v.array(ResolverPermissionConditionSchema),
      v.minLength(1, "Resolver permission policy must have at least one condition"),
      v.readonly(),
    ),
  ]),
  permit: v.boolean(),
  description: v.optional(
    v.pipe(
      v.string(),
      v.description("Reason recorded for this policy, used in the access-denied error message"),
    ),
  ),
});

export const ResolverPermissionSchema = v.pipe(
  v.union([
    v.pipe(
      v.array(ResolverPermissionPolicySchema),
      v.minLength(1, "Resolver permission must have at least one policy"),
      v.check(
        (policies) => policies.some((policy) => policy.permit === true),
        "Resolver permission must include at least one `permit: true` policy — a policy array " +
          "with only `permit: false` policies still lets any caller through by simply not " +
          "authenticating, since none of the deny conditions apply to a caller with no user " +
          "attributes at all",
      ),
      v.readonly(),
    ),
    v.literal("allowAnonymous"),
  ]),
  v.description(
    "Access requirement for this resolver, evaluated against the original caller " +
      '(unaffected by `invoker`) before `body` runs. "allowAnonymous" documents that ' +
      "anonymous callers are allowed. Omitted (default): unchanged, anonymous callers can " +
      "reach the resolver",
  ),
);

export const ResolverSchema = v.strictObject({
  operation: v.pipe(QueryTypeSchema, v.description("GraphQL operation type (query or mutation)")),
  name: v.pipe(v.string(), v.description("Resolver name")),
  description: v.optional(v.pipe(v.string(), v.description("Resolver description"))),
  input: v.optional(
    v.pipe(v.record(v.string(), TailorFieldSchema), v.description("Input field definitions")),
  ),
  body: v.pipe(functionSchema, v.description("Resolver implementation function")),
  output: v.pipe(TailorFieldSchema, v.description("Output field definition")),
  publishEvents: v.optional(
    v.pipe(v.boolean(), v.description("Enable publishing events from this resolver")),
  ),
  invoker: v.optional(
    v.pipe(AuthInvokerSchema, v.description("Machine user to execute this resolver as")),
  ),
  permission: v.optional(ResolverPermissionSchema),
});
