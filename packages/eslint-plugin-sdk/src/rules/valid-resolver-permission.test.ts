import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "valid-resolver-permission";
const NO_PERMIT =
  "Resolver permission must include at least one `permit: true` policy; a policy list with only `permit: false` policies lets through any caller who does not authenticate.";
const USER_SIDE =
  "Resolver permission condition must reference a `user` operand on exactly one side (comparing two `user` operands to each other can match on `undefined === undefined`).";
const OPERAND_VALUE = "A `user` operand must compare to a string or a boolean.";

function resolver(permission: string): string {
  return `import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1, permission: ${permission} });`;
}

function config(defaultPermission: string): string {
  return `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "app", resolver: { main: { files: ["./src/resolver/*.ts"], defaultPermission: ${defaultPermission} } } });`;
}

describe("rejects permission arrays without a permit: true policy", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver('[{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]'),
        errors: [NO_PERMIT],
      },
      {
        code: resolver("[]"),
        errors: ["Resolver permission must have at least one policy."],
      },
      {
        code: config('[{ conditions: [[{ user: "role" }, "!=", "ADMIN"]], permit: false }]'),
        errors: [NO_PERMIT],
      },
    ],
  });
});

describe("rejects conditions that compare user operands to each other or to nothing", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver(
          '[{ conditions: [[{ user: "role" }, "=", { user: "team" }]], permit: true }]',
        ),
        errors: [USER_SIDE],
      },
      {
        code: resolver('[{ conditions: [["ADMIN", "=", "ADMIN"]], permit: true }]'),
        errors: [USER_SIDE],
      },
      {
        code: resolver('[{ conditions: [{ user: "role" }, "=", { user: "team" }], permit: true }]'),
        errors: [USER_SIDE],
      },
      {
        code: resolver("[{ conditions: [], permit: true }]"),
        errors: ["Resolver permission policy must have at least one condition."],
      },
    ],
  });
});

describe("rejects known user operands compared to the wrong literal type", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver('[{ conditions: [[{ user: "_loggedIn" }, "=", "true"]], permit: true }]'),
        errors: ["`_loggedIn` must compare to a boolean."],
      },
      {
        code: resolver('[{ conditions: [[true, "=", { user: "id" }]], permit: true }]'),
        errors: ["`id` must compare to a string."],
      },
    ],
  });
});

describe("rejects operands that are not a user object, string, or boolean", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver('[{ conditions: [[{ user: "id" }, "=", 5]], permit: true }]'),
        errors: [OPERAND_VALUE],
      },
      {
        code: resolver('[{ conditions: [[{ user: "role" }, "=", 5]], permit: true }]'),
        errors: [OPERAND_VALUE],
      },
      {
        code: resolver('[{ conditions: [[{ user: "role" }, "=", null]], permit: true }]'),
        errors: [OPERAND_VALUE],
      },
    ],
  });
});

describe("accepts valid permissions", () => {
  runRuleTests(RULE, {
    valid: [
      resolver('[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]'),
      resolver(
        '[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false, description: "banned" }]',
      ),
      resolver('[{ conditions: [{ user: "role" }, "=", "ADMIN"], permit: true }]'),
      resolver('[{ conditions: [["ADMIN", "!=", { user: "role" }]], permit: true }]'),
      resolver('"allowAnonymous"'),
      config('[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]'),
      config('"allowAnonymous"'),
    ],
  });
});

describe("follows const values", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { createResolver } from "@tailor-platform/sdk";\nconst denyBanned = { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false };\nconst permission = [denyBanned];\nexport default createResolver({ name: "r", body: () => 1, permission });',
        errors: [NO_PERMIT],
      },
    ],
  });
});

describe("skips a permission a later spread can override", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1, permission: [], ...overrides });',
      'import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "app", resolver: { main: { files: [], defaultPermission: [] }, ...extra } });',
    ],
  });
});

describe("skips values it cannot resolve statically", () => {
  runRuleTests(RULE, {
    valid: [
      resolver("buildPermission()"),
      resolver('[{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: allow }]'),
      resolver(
        '[...sharedPolicies, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]',
      ),
      resolver('[{ conditions: [[{ user: "role" }, "=", expected]], permit: true }]'),
      resolver('[{ conditions: [[operand, "=", { user: "role" }]], permit: true }]'),
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createResolver } from "another-sdk";\nexport default createResolver({ permission: [{ conditions: [], permit: false }] });',
    ],
  });
});
