import { Linter } from "eslint";
import { describe, expect, test } from "vitest";
import plugin from "../index.js";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-unconditional-permit";
const UNCONDITIONAL_ENTRY =
  "This permission entry permits access without any conditions; add conditions or remove it.";

function unsafeConstant(name: string): string {
  return `${name} grants access unconditionally; define restrictive permission conditions instead.`;
}

describe.each([
  "unsafeAllowAllTypePermission",
  "unsafeAllowAllGqlPermission",
  "unsafeAllowAllIdPPermission",
])("rejects any use of %s", (name) => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `import { ${name} } from "@tailor-platform/sdk";\nexport const defaultPermission = ${name};`,
        errors: [unsafeConstant(name)],
      },
    ],
  });
});

describe("rejects an unsafe constant re-exported from the module once", () => {
  const code =
    'import { unsafeAllowAllTypePermission as permission } from "@tailor-platform/sdk";\nexport { permission };';

  runRuleTests(RULE, {
    invalid: [{ code, errors: [unsafeConstant("unsafeAllowAllTypePermission")] }],
  });

  test("under ESLint", () => {
    const messages = new Linter().verify(
      code,
      [{ plugins: { "tailor-sdk": plugin }, rules: { [`tailor-sdk/${RULE}`]: "error" } }],
      { filename: "fixture.js" },
    );

    expect(messages.map(({ message }) => message)).toEqual([
      unsafeConstant("unsafeAllowAllTypePermission"),
    ]);
  });
});

describe("rejects unconditional entries in defineIdp permissions", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { defineIdp } from "@tailor-platform/sdk";\nexport const idp = defineIdp("my-idp", { clients: [], permission: { create: [], read: [], update: [], delete: [], sendPasswordResetEmail: [{ conditions: [], permit: true }] } });',
        errors: [UNCONDITIONAL_ENTRY],
      },
    ],
  });
});

describe.each(["type", "table"])("on db.%s", (factory) => {
  describe("rejects the unsafe constants through aliases and namespaces", () => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db, unsafeAllowAllTypePermission as allowAll } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission(allowAll);`,
          errors: [unsafeConstant("unsafeAllowAllTypePermission")],
        },
        {
          code: 'import * as sdk from "@tailor-platform/sdk";\nexport const permission = sdk.unsafeAllowAllGqlPermission;',
          errors: [unsafeConstant("unsafeAllowAllGqlPermission")],
        },
      ],
    });
  });

  describe("rejects unconditional entries in database permissions", () => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] });`,
          errors: [UNCONDITIONAL_ENTRY],
        },
      ],
    });
  });

  describe("rejects unconditional gql policies on chained calls", () => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db } from "@tailor-platform/sdk";\nconst gql = [{ conditions: [], actions: "all", permit: true }];\nexport const user = db.${factory}("User", {}).features({ gqlOperations: "query" }).gqlPermission(gql);`,
          errors: [UNCONDITIONAL_ENTRY],
        },
      ],
    });
  });

  describe("rejects unconditional entries via same-file constants and stored receivers", () => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db } from "@tailor-platform/sdk";\nconst permission = { create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] };\nconst user = db.${factory}("User", {});\nexport const typed = user.permission(permission);`,
          errors: [UNCONDITIONAL_ENTRY],
        },
      ],
    });
  });

  describe.each([
    [
      "permission",
      "{ create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] }",
    ],
    ["gqlPermission", '[{ conditions: [], actions: "all", permit: true }]'],
  ])("rejects unconditional %s entries through aliases and namespaces", (method, permission) => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db as database } from "@tailor-platform/sdk";\nexport const user = database.${factory}("User", {}).features({ gqlOperations: "query" }).${method}(${permission});`,
          errors: [UNCONDITIONAL_ENTRY],
        },
        {
          code: `import * as sdk from "@tailor-platform/sdk";\nexport const user = sdk.db.${factory}("User", {}).${method}(${permission});`,
          errors: [UNCONDITIONAL_ENTRY],
        },
      ],
    });
  });

  describe("rejects unconditional shorthand entries", () => {
    runRuleTests(RULE, {
      invalid: [
        {
          code: `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [[]], read: [], update: [], delete: [] });`,
          errors: [UNCONDITIONAL_ENTRY],
        },
        {
          code: `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [[true]], read: [], update: [], delete: [] });`,
          errors: [UNCONDITIONAL_ENTRY],
        },
      ],
    });
  });

  describe("accepts conditional shorthand entries and empty action lists", () => {
    runRuleTests(RULE, {
      valid: [
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [[{ user: "role" }, "=", "MANAGER"]], read: [], update: [], delete: [] });`,
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [[false]], read: [], update: [], delete: [] });`,
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).gqlPermission([]);`,
      ],
    });
  });

  describe("accepts conditional and deny entries", () => {
    runRuleTests(RULE, {
      valid: [
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }], read: [], update: [], delete: [] });`,
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [{ conditions: [], permit: false }], read: [], update: [], delete: [] });`,
        `import { db } from "@tailor-platform/sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [{ conditions: [] }], read: [], update: [], delete: [] });`,
      ],
    });
  });

  describe("ignores unrelated APIs and other packages", () => {
    runRuleTests(RULE, {
      valid: [
        `import { db } from "another-sdk";\nexport const user = db.${factory}("User", {}).permission({ create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] });`,
        'import { client } from "@tailor-platform/sdk";\nexport const value = client.permission({ conditions: [], permit: true });',
        'import { unsafeAllowAllTypePermission } from "another-sdk";\nexport const permission = unsafeAllowAllTypePermission;',
      ],
    });
  });
});
