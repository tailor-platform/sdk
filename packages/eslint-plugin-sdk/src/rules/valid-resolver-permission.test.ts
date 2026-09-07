/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "valid-resolver-permission";
const NO_PERMIT = "must include at least one `permit: true` policy";
const NO_POLICY = "Resolver permission must have at least one policy";
const NO_CONDITION = "Resolver permission policy must have at least one condition";
const USER_SIDE = "must reference a `user` operand on exactly one side";

function resolver(permission: string): string {
  return `import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1, permission: ${permission} });`;
}

function config(defaultPermission: string): string {
  return `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "app", resolver: { main: { files: ["./src/resolver/*.ts"], defaultPermission: ${defaultPermission} } } });`;
}

describe("valid-resolver-permission", () => {
  test("rejects permission arrays without a permit: true policy", () => {
    expectViolation(
      resolver('[{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]'),
      RULE,
      NO_PERMIT,
    );
    expectViolation(resolver("[]"), RULE, NO_POLICY);
    expectViolation(
      config('[{ conditions: [[{ user: "role" }, "!=", "ADMIN"]], permit: false }]'),
      RULE,
      NO_PERMIT,
    );
  });

  test("rejects conditions that compare user operands to each other or to nothing", () => {
    expectViolation(
      resolver('[{ conditions: [[{ user: "role" }, "=", { user: "team" }]], permit: true }]'),
      RULE,
      USER_SIDE,
    );
    expectViolation(
      resolver('[{ conditions: [["ADMIN", "=", "ADMIN"]], permit: true }]'),
      RULE,
      USER_SIDE,
    );
    expectViolation(
      resolver('[{ conditions: [{ user: "role" }, "=", { user: "team" }], permit: true }]'),
      RULE,
      USER_SIDE,
    );
    expectViolation(resolver("[{ conditions: [], permit: true }]"), RULE, NO_CONDITION);
  });

  test("rejects known user operands compared to the wrong literal type", () => {
    expectViolation(
      resolver('[{ conditions: [[{ user: "_loggedIn" }, "=", "true"]], permit: true }]'),
      RULE,
      "`_loggedIn` must compare to a boolean",
    );
    expectViolation(
      resolver('[{ conditions: [[true, "=", { user: "id" }]], permit: true }]'),
      RULE,
      "`id` must compare to a string",
    );
  });

  test("accepts valid permissions", () => {
    expectClean(
      resolver('[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]'),
      RULE,
    );
    expectClean(
      resolver(
        '[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false, description: "banned" }]',
      ),
      RULE,
    );
    expectClean(resolver('[{ conditions: [{ user: "role" }, "=", "ADMIN"], permit: true }]'), RULE);
    expectClean(
      resolver('[{ conditions: [["ADMIN", "!=", { user: "role" }]], permit: true }]'),
      RULE,
    );
    expectClean(resolver('"allowAnonymous"'), RULE);
    expectClean(
      config('[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]'),
      RULE,
    );
    expectClean(config('"allowAnonymous"'), RULE);
  });

  test("follows const values", () => {
    expectViolation(
      'import { createResolver } from "@tailor-platform/sdk";\nconst denyBanned = { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false };\nconst permission = [denyBanned];\nexport default createResolver({ name: "r", body: () => 1, permission });',
      RULE,
      NO_PERMIT,
    );
  });

  test("skips values it cannot resolve statically", () => {
    expectClean(resolver("buildPermission()"), RULE);
    expectClean(
      resolver('[{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: allow }]'),
      RULE,
    );
    expectClean(
      resolver(
        '[...sharedPolicies, { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }]',
      ),
      RULE,
    );
    expectClean(
      resolver('[{ conditions: [[{ user: "role" }, "=", expected]], permit: true }]'),
      RULE,
    );
    expectClean(
      resolver('[{ conditions: [[operand, "=", { user: "role" }]], permit: true }]'),
      RULE,
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createResolver } from "another-sdk";\nexport default createResolver({ permission: [{ conditions: [], permit: false }] });',
      RULE,
    );
  });
});
