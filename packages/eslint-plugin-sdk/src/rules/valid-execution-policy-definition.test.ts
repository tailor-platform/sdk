/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "valid-execution-policy-definition";
const GROUP = 'import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";\n';
const SINGLE = 'import { defineWorkflowExecutionPolicy } from "@tailor-platform/sdk";\n';
const NAME_MESSAGE = "Invalid execution policy name";
const KEY_MESSAGE = "Invalid execution policy key";
const WILDCARD_MESSAGE = "key must not end with '*'";

describe("valid-execution-policy-definition", () => {
  test("rejects a property-name-derived name that violates the grammar", () => {
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ tenantApi: define({ matchType: "prefix" }) }));`,
      RULE,
      NAME_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ ab: define() }));`,
      RULE,
      NAME_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ "tenant_api": define({ concurrencyPolicy: { maxConcurrentExecutions: 1 } }) }));`,
      RULE,
      NAME_MESSAGE,
    );
  });

  test("rejects explicit names and keys that violate the grammar", () => {
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "Premium" }) }));`,
      RULE,
      NAME_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "premium/eu" }) }));`,
      RULE,
      KEY_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "p" }) }));`,
      RULE,
      KEY_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "tenant*" }) }));`,
      RULE,
      WILDCARD_MESSAGE,
    );
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "Tenant", matchType: "prefix" }) }));`,
      RULE,
      KEY_MESSAGE,
    );
  });

  test("checks defineWorkflowExecutionPolicy calls", () => {
    expectViolation(
      `${SINGLE}export const policy = defineWorkflowExecutionPolicy("BAD");`,
      RULE,
      NAME_MESSAGE,
    );
    expectViolation(
      `${SINGLE}export const policy = defineWorkflowExecutionPolicy("tenant-api", { key: "tenant api" });`,
      RULE,
      KEY_MESSAGE,
    );
  });

  test("ignores def.name on the single-policy path, which never reads it", () => {
    expectViolation(
      `${SINGLE}const opts = { name: "tenant-api" };\nexport const policy = defineWorkflowExecutionPolicy("BAD", opts);`,
      RULE,
      NAME_MESSAGE,
    );
    expectClean(
      `${SINGLE}const opts = { name: "Premium" };\nexport const policy = defineWorkflowExecutionPolicy("tenant-api", opts);`,
      RULE,
    );
  });

  test("resolves the builder parameter and const values", () => {
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((d) => ({ premium: d({ name: "Premium" }) }));`,
      RULE,
      NAME_MESSAGE,
    );
    expectViolation(
      `${GROUP}const options = { name: "Premium" };\nexport const policies = defineWorkflowExecutionPolicies((define) => {\n  return { premium: define(options) };\n});`,
      RULE,
      NAME_MESSAGE,
    );
  });

  test("checks every returned object in a block body", () => {
    expectViolation(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => {\n  if (extended) return { Premium: define() };\n  return { premium: define() };\n});`,
      RULE,
      NAME_MESSAGE,
    );
  });

  test("accepts valid definitions, including the example project's", () => {
    expectClean(
      `${GROUP}export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({\n  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),\n  tenantApi: define({ name: "tenant-api", matchType: "prefix", concurrencyPolicy: { maxConcurrentExecutions: 3 } }),\n}));`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ "tenant-api": define({ key: "tenant:api.v1" }), a1b: define() }));`,
      RULE,
    );
    expectClean(
      `${SINGLE}export const policy = defineWorkflowExecutionPolicy("tenant-api", { matchType: "prefix", key: "t" });`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "tenant-", matchType: "prefix" }) }));`,
      RULE,
    );
  });

  test("skips values it cannot resolve statically", () => {
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: process.env.POLICY_NAME }) }));`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "Premium", ...overrides }) }));`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ [dynamicName]: define() }));`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies(buildPolicies);`,
      RULE,
    );
    expectClean(
      `${GROUP}const policies = { premium: define({ name: "Premium" }) };\nexport const group = defineWorkflowExecutionPolicies((define) => policies);`,
      RULE,
    );
    expectClean(
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => {\n  const define2 = (o: unknown) => define(o);\n  return { premium: define2({ name: "Premium" }) };\n});`,
      RULE,
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { defineWorkflowExecutionPolicies } from "another-sdk";\nexport const policies = defineWorkflowExecutionPolicies((define) => ({ Premium: define() }));',
      RULE,
    );
  });
});
