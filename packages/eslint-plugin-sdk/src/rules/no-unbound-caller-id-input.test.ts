import { describe } from "vitest";
import { resolverSource, runRuleTests } from "./test-helpers.js";

const RULE = "no-unbound-caller-id-input";
const ADMIN_POLICY = '{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }';

function noPolicy(name: string): string {
  return `\`${name}\` looks like the caller's ID but no \`permission\` policy compares it with the caller, so a caller can act as another user by sending that user's ID. Take the acting user from \`caller\` in \`body\`, or declare \`permission\` with \`permit: true\` policies that each include \`[{ input: "${name}" }, "=", { user: "id" }]\`.`;
}

function unboundPolicy(name: string): string {
  return `\`${name}\` looks like the caller's ID but is not compared with the caller in every \`permit: true\` policy of \`permission\`, so a caller can act as another user by sending that user's ID. Take the acting user from \`caller\` in \`body\`, or add \`[{ input: "${name}" }, "=", { user: "id" }]\` to every \`permit: true\` policy.`;
}

function bound(name: string, user = "id"): string {
  return `{ conditions: [[{ input: "${name}" }, "=", { user: "${user}" }]], permit: true }`;
}

describe("reports a caller-ID input that not every permit: true policy binds", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolverSource({ input: "{ approverId: t.uuid() }" }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: "{ approverId: t.uuid() }", permission: '"allowAnonymous"' }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ approverId: t.uuid() }",
          permission: `[${ADMIN_POLICY}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ actorId: t.uuid() }",
          permission: `[${bound("actorId")}, { conditions: [[{ user: "role" }, "=", "MEMBER"]], permit: true }]`,
        }),
        errors: [unboundPolicy("actorId")],
      },
      {
        code: resolverSource({
          input: "{ approverId: t.uuid() }",
          permission:
            '[{ conditions: [[{ input: "approverId" }, "!=", { user: "id" }]], permit: true }]',
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ approverId: t.uuid() }",
          permission: '[{ conditions: [[{ input: "approverId" }, "=", "fixed"]], permit: true }]',
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ requesterId: t.uuid(), approverId: t.uuid(), note: t.string() }",
          permission: `[${bound("requesterId")}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ approverId: t.uuid() }",
          permission: `[sharedPolicy, ${ADMIN_POLICY}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolverSource({
          input: "{ approverId: t.uuid() }",
          permission: `[...sharedPolicies, ${ADMIN_POLICY}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
    ],
  });
});

describe.each([
  "approverId",
  "requesterId",
  "creatorId",
  "authorId",
  "invokerId",
  "actor_user_id",
  "ApproverId",
  "currentUserId",
  "modifiedBy",
  "lastUpdatedBy",
  "uploadedBy",
  "createdByUserId",
  "CreatedBy",
  "created_by_id",
  "CREATED_BY",
])("reports %s", (name) => {
  runRuleTests(RULE, {
    invalid: [
      { code: resolverSource({ input: `{ ${name}: t.uuid() }` }), errors: [noPolicy(name)] },
    ],
  });
});

describe("reads uuid fields in the forms resolver input accepts", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolverSource({
          input: '{ approverId: t.uuid({ optional: true }).description("approver") }',
        }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: "{ approverId: t.uuid({ array: false }) }" }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: "{ approverId: db.uuid() }" }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: '{ "approverId": t.uuid() }' }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: "{ ...shared, approverId: t.uuid() }" }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolverSource({ input: "{ approverId: t.uuid() satisfies unknown }" }),
        errors: [noPolicy("approverId")],
      },
      {
        code: `import { createResolver, t } from "@tailor-platform/sdk";\nconst approverId = t.uuid();\nconst input = { approverId };\nconst permission = [${ADMIN_POLICY}];\nexport default createResolver({ name: "r", operation: "mutation", input, body: () => 1, output: t.int(), permission });`,
        errors: [unboundPolicy("approverId")],
      },
      {
        code: `import * as sdk from "@tailor-platform/sdk";\nexport default sdk.createResolver({ name: "r", operation: "mutation", input: { approverId: sdk.t.uuid() }, body: () => 1, output: sdk.t.int() });`,
        errors: [noPolicy("approverId")],
      },
    ],
  });
});

describe("accepts an input every permit: true policy binds to the caller", () => {
  runRuleTests(RULE, {
    valid: [
      resolverSource({ input: "{ approverId: t.uuid() }", permission: `[${bound("approverId")}]` }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission:
          '[{ conditions: [[{ user: "employeeId" }, "=", { input: "approverId" }]], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission:
          '[{ conditions: [{ input: "approverId" }, "=", { user: "id" }], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission:
          '[{ conditions: [[{ input: "approverId" }, "=", { user: "id" }], [{ user: "role" }, "=", "MEMBER"]], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission: `[${bound("approverId")}, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]`,
      }),
    ],
  });
});

describe("ignores inputs that are not a mutation's uuid named like the caller's ID", () => {
  runRuleTests(RULE, {
    valid: [
      resolverSource({ input: "{ approverId: t.uuid() }", operation: "query" }),
      resolverSource({ input: "{ approverId: t.string() }" }),
      resolverSource({ input: "{ approverId: t.uuid({ array: true }) }" }),
      resolverSource({ input: "{ orderId: t.uuid() }" }),
      resolverSource({ input: "{ userId: t.uuid() }" }),
      resolverSource({ input: "{ lobbyId: t.uuid() }" }),
      'import { createResolver } from "@tailor-platform/sdk";\nimport { t } from "./fields";\nexport default createResolver({ name: "r", operation: "mutation", input: { approverId: t.uuid() }, body: () => 1, output: t.int() });',
      resolverSource({
        prelude: 'const user = db.table("User", { name: db.string() });',
        input: "{ approverId: user.fields.id }",
      }),
    ],
  });
});

describe("skips values it cannot read statically", () => {
  runRuleTests(RULE, {
    valid: [
      resolverSource({ input: "{ approverId: t.uuid() }", operation: { source: "operation" } }),
      resolverSource({ input: "{ approverId: t.uuid() }", permission: "sharedPermission" }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission: '[{ conditions: [[{ user: "role" }, "=", "MEMBER"]], permit: isOpen }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission:
          '[{ conditions: [[{ user: "role" }, "=", "MEMBER"], ownApprover], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission: '[{ conditions: [[approverOperand, "=", { user: "id" }]], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission:
          '[{ conditions: [[{ input: approverField }, "=", { user: "id" }]], permit: true }]',
      }),
      resolverSource({
        input: "{ approverId: t.uuid() }",
        permission: "[{ conditions: shared, permit: true }]",
      }),
      resolverSource({ input: "{ approverId: t.uuid(), ...shared }" }),
      resolverSource({ input: '{ ["approverId"]: t.uuid() }' }),
      resolverSource({ input: "{ approverId: t.uuid(options) }" }),
      resolverSource({ input: "{ approverId: t.uuid({ array: isArray }) }" }),
      'import { createResolver, t } from "@tailor-platform/sdk";\nexport default createResolver({ ...base, name: "r", operation: "mutation", input: { approverId: t.uuid() }, body: () => 1, output: t.int() });',
    ],
  });
});
