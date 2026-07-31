/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

describe("no-unconditional-permit", () => {
  test.each([
    "unsafeAllowAllTypePermission",
    "unsafeAllowAllGqlPermission",
    "unsafeAllowAllIdPPermission",
  ])("rejects any use of %s", (name) => {
    expectViolation(
      `import { ${name} } from "@tailor-platform/sdk";\nexport const defaultPermission = ${name};`,
      "no-unconditional-permit",
      `${name} grants access unconditionally; define restrictive permission conditions instead.`,
    );
  });

  test("rejects the unsafe constants through aliases and namespaces", () => {
    expectViolation(
      'import { db, unsafeAllowAllTypePermission as allowAll } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission(allowAll);',
      "no-unconditional-permit",
      "unsafeAllowAllTypePermission grants access unconditionally",
    );
    expectViolation(
      'import * as sdk from "@tailor-platform/sdk";\nexport const permission = sdk.unsafeAllowAllGqlPermission;',
      "no-unconditional-permit",
      "unsafeAllowAllGqlPermission grants access unconditionally",
    );
  });

  test("rejects unconditional entries in type permissions", () => {
    expectViolation(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
  });

  test("rejects unconditional gql policies on chained calls", () => {
    expectViolation(
      'import { db } from "@tailor-platform/sdk";\nconst gql = [{ conditions: [], actions: "all", permit: true }];\nexport const user = db.type("User", {}).features({ gqlOperations: "query" }).gqlPermission(gql);',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
  });

  test("rejects unconditional entries via same-file constants and stored types", () => {
    expectViolation(
      'import { db } from "@tailor-platform/sdk";\nconst permission = { create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] };\nconst user = db.type("User", {});\nexport const typed = user.permission(permission);',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
  });

  test("rejects unconditional entries in defineIdp permissions", () => {
    expectViolation(
      'import { defineIdp } from "@tailor-platform/sdk";\nexport const idp = defineIdp("my-idp", { clients: [], permission: { create: [], read: [], update: [], delete: [], sendPasswordResetEmail: [{ conditions: [], permit: true }] } });',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
  });

  test("rejects unconditional shorthand entries", () => {
    expectViolation(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [[]], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
    expectViolation(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [[true]], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
      "This permission entry permits access without any conditions; add conditions or remove it.",
    );
  });

  test("accepts conditional shorthand entries and empty action lists", () => {
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [[{ user: "role" }, "=", "MANAGER"]], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [[false]], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).gqlPermission([]);',
      "no-unconditional-permit",
    );
  });

  test("accepts conditional and deny entries", () => {
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [{ conditions: [], permit: false }], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { db } from "@tailor-platform/sdk";\nexport const user = db.type("User", {}).permission({ create: [{ conditions: [] }], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
  });

  test("ignores unrelated APIs and other packages", () => {
    expectClean(
      'import { db } from "another-sdk";\nexport const user = db.type("User", {}).permission({ create: [{ conditions: [], permit: true }], read: [], update: [], delete: [] });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { client } from "@tailor-platform/sdk";\nexport const value = client.permission({ conditions: [], permit: true });',
      "no-unconditional-permit",
    );
    expectClean(
      'import { unsafeAllowAllTypePermission } from "another-sdk";\nexport const permission = unsafeAllowAllTypePermission;',
      "no-unconditional-permit",
    );
  });
});
