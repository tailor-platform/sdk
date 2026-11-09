import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-unbound-caller-id-input";
const ADMIN_POLICY = '{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }';

function noPolicy(name: string): string {
  return `\`${name}\` looks like the caller's ID but no \`permission\` policy compares it with the caller, so a caller can act as another user by sending that user's ID. Take the acting user from \`caller\` in \`body\`, or declare \`permission\` with \`permit: true\` policies that each include \`[{ input: "${name}" }, "=", { user: "id" }]\`.`;
}

function unboundPolicy(name: string): string {
  return `\`${name}\` looks like the caller's ID but is not compared with the caller in every \`permit: true\` policy of \`permission\`, so a caller can act as another user by sending that user's ID. Take the acting user from \`caller\` in \`body\`, or add \`[{ input: "${name}" }, "=", { user: "id" }]\` to every \`permit: true\` policy.`;
}

function resolver(
  input: string,
  { permission, operation = '"mutation"' }: { permission?: string; operation?: string } = {},
): string {
  const permissionOption = permission === undefined ? "" : `, permission: ${permission}`;
  return `import { createResolver, db, t } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", operation: ${operation}, input: ${input}, body: () => 1, output: t.int()${permissionOption} });`;
}

function bound(name: string, user = "id"): string {
  return `{ conditions: [[{ input: "${name}" }, "=", { user: "${user}" }]], permit: true }`;
}

describe("reports a caller-ID input that not every permit: true policy binds", () => {
  runRuleTests(RULE, {
    invalid: [
      { code: resolver("{ approverId: t.uuid() }"), errors: [noPolicy("approverId")] },
      {
        code: resolver("{ approverId: t.uuid() }", { permission: '"allowAnonymous"' }),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolver("{ approverId: t.uuid() }", { permission: `[${ADMIN_POLICY}]` }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolver("{ actorId: t.uuid() }", {
          permission: `[${bound("actorId")}, { conditions: [[{ user: "role" }, "=", "MEMBER"]], permit: true }]`,
        }),
        errors: [unboundPolicy("actorId")],
      },
      {
        code: resolver("{ approverId: t.uuid() }", {
          permission:
            '[{ conditions: [[{ input: "approverId" }, "!=", { user: "id" }]], permit: true }]',
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolver("{ approverId: t.uuid() }", {
          permission: '[{ conditions: [[{ input: "approverId" }, "=", "fixed"]], permit: true }]',
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolver("{ requesterId: t.uuid(), approverId: t.uuid(), note: t.string() }", {
          permission: `[${bound("requesterId")}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolver("{ approverId: t.uuid() }", {
          permission: `[sharedPolicy, ${ADMIN_POLICY}]`,
        }),
        errors: [unboundPolicy("approverId")],
      },
      {
        code: resolver("{ approverId: t.uuid() }", {
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
    invalid: [{ code: resolver(`{ ${name}: t.uuid() }`), errors: [noPolicy(name)] }],
  });
});

describe("reads uuid fields in the forms resolver input accepts", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver('{ approverId: t.uuid({ optional: true }).description("approver") }'),
        errors: [noPolicy("approverId")],
      },
      {
        code: resolver("{ approverId: t.uuid({ array: false }) }"),
        errors: [noPolicy("approverId")],
      },
      { code: resolver("{ approverId: db.uuid() }"), errors: [noPolicy("approverId")] },
      { code: resolver('{ "approverId": t.uuid() }'), errors: [noPolicy("approverId")] },
      { code: resolver("{ ...shared, approverId: t.uuid() }"), errors: [noPolicy("approverId")] },
      {
        code: resolver("{ approverId: t.uuid() satisfies unknown }"),
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
      resolver("{ approverId: t.uuid() }", { permission: `[${bound("approverId")}]` }),
      resolver("{ approverId: t.uuid() }", {
        permission:
          '[{ conditions: [[{ user: "employeeId" }, "=", { input: "approverId" }]], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission:
          '[{ conditions: [{ input: "approverId" }, "=", { user: "id" }], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission:
          '[{ conditions: [[{ input: "approverId" }, "=", { user: "id" }], [{ user: "role" }, "=", "MEMBER"]], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission: `[${bound("approverId")}, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]`,
      }),
    ],
  });
});

describe("ignores inputs that are not a mutation's uuid named like the caller's ID", () => {
  runRuleTests(RULE, {
    valid: [
      resolver("{ approverId: t.uuid() }", { operation: '"query"' }),
      resolver("{ approverId: t.string() }"),
      resolver("{ approverId: t.uuid({ array: true }) }"),
      resolver("{ orderId: t.uuid() }"),
      resolver("{ userId: t.uuid() }"),
      resolver("{ lobbyId: t.uuid() }"),
      'import { createResolver } from "@tailor-platform/sdk";\nimport { t } from "./fields";\nexport default createResolver({ name: "r", operation: "mutation", input: { approverId: t.uuid() }, body: () => 1, output: t.int() });',
      'import { createResolver, db, t } from "@tailor-platform/sdk";\nconst user = db.table("User", { name: db.string() });\nexport default createResolver({ name: "r", operation: "mutation", input: { approverId: user.fields.id }, body: () => 1, output: t.int() });',
    ],
  });
});

describe("skips values it cannot read statically", () => {
  runRuleTests(RULE, {
    valid: [
      resolver("{ approverId: t.uuid() }", { operation: "operation" }),
      resolver("{ approverId: t.uuid() }", { permission: "sharedPermission" }),
      resolver("{ approverId: t.uuid() }", {
        permission: '[{ conditions: [[{ user: "role" }, "=", "MEMBER"]], permit: isOpen }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission:
          '[{ conditions: [[{ user: "role" }, "=", "MEMBER"], ownApprover], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission: '[{ conditions: [[approverOperand, "=", { user: "id" }]], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission:
          '[{ conditions: [[{ input: approverField }, "=", { user: "id" }]], permit: true }]',
      }),
      resolver("{ approverId: t.uuid() }", {
        permission: "[{ conditions: shared, permit: true }]",
      }),
      resolver("{ approverId: t.uuid(), ...shared }"),
      resolver('{ ["approverId"]: t.uuid() }'),
      resolver("{ approverId: t.uuid(options) }"),
      resolver("{ approverId: t.uuid({ array: isArray }) }"),
      'import { createResolver, t } from "@tailor-platform/sdk";\nexport default createResolver({ ...base, name: "r", operation: "mutation", input: { approverId: t.uuid() }, body: () => 1, output: t.int() });',
    ],
  });
});
