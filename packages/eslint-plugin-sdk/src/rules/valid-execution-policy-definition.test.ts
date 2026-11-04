import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "valid-execution-policy-definition";
const GROUP = 'import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";\n';
const SINGLE = 'import { defineWorkflowExecutionPolicy } from "@tailor-platform/sdk";\n';
const NAME_MESSAGE =
  "Invalid execution policy name: must match [a-z0-9-] (3-63 chars; must start and end with [a-z0-9])";
const KEY_MESSAGE =
  "Invalid execution policy key: must match [a-z0-9_:.-] (2-64 chars; must start with [a-z0-9] and end with [a-z0-9] or a trailing '*')";
const WILDCARD_MESSAGE =
  "key must not end with '*'; omit the '*' and set matchType: \"prefix\" for wildcard policies (the SDK appends '*' automatically).";

describe("rejects a property-name-derived name that violates the grammar", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ tenantApi: define({ matchType: "prefix" }) }));`,
        errors: [`${NAME_MESSAGE} (got "tenantApi")`, `${KEY_MESSAGE} (got "tenantApi*")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ ab: define() }));`,
        errors: [`${NAME_MESSAGE} (got "ab")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ "tenant_api": define({ concurrencyPolicy: { maxConcurrentExecutions: 1 } }) }));`,
        errors: [`${NAME_MESSAGE} (got "tenant_api")`],
      },
    ],
  });
});

describe("rejects explicit names and keys that violate the grammar", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "Premium" }) }));`,
        errors: [`${NAME_MESSAGE} (got "Premium")`, `${KEY_MESSAGE} (got "Premium")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "premium/eu" }) }));`,
        errors: [`${KEY_MESSAGE} (got "premium/eu")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "p" }) }));`,
        errors: [`${KEY_MESSAGE} (got "p")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "tenant*" }) }));`,
        errors: [`${WILDCARD_MESSAGE} (got "tenant*")`],
      },
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "Tenant", matchType: "prefix" }) }));`,
        errors: [`${KEY_MESSAGE} (got "Tenant*")`],
      },
    ],
  });
});

describe("checks defineWorkflowExecutionPolicy calls", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${SINGLE}export const policy = defineWorkflowExecutionPolicy("BAD");`,
        errors: [`${NAME_MESSAGE} (got "BAD")`, `${KEY_MESSAGE} (got "BAD")`],
      },
      {
        code: `${SINGLE}export const policy = defineWorkflowExecutionPolicy("tenant-api", { key: "tenant api" });`,
        errors: [`${KEY_MESSAGE} (got "tenant api")`],
      },
    ],
  });
});

describe("ignores def.name on the single-policy path, which never reads it", () => {
  runRuleTests(RULE, {
    valid: [
      `${SINGLE}const opts = { name: "Premium" };\nexport const policy = defineWorkflowExecutionPolicy("tenant-api", opts);`,
    ],
    invalid: [
      {
        code: `${SINGLE}const opts = { name: "tenant-api" };\nexport const policy = defineWorkflowExecutionPolicy("BAD", opts);`,
        errors: [`${NAME_MESSAGE} (got "BAD")`, `${KEY_MESSAGE} (got "BAD")`],
      },
    ],
  });
});

describe("reads the last duplicate key, as the runtime does", () => {
  runRuleTests(RULE, {
    valid: [
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "BAD", name: "tenant-api" }) }));`,
    ],
    invalid: [
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "tenant-api", name: "BAD" }) }));`,
        errors: [`${NAME_MESSAGE} (got "BAD")`, `${KEY_MESSAGE} (got "BAD")`],
      },
    ],
  });
});

describe("resolves the builder parameter and const values", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((d) => ({ premium: d({ name: "Premium" }) }));`,
        errors: [`${NAME_MESSAGE} (got "Premium")`, `${KEY_MESSAGE} (got "Premium")`],
      },
      {
        code: `${GROUP}const options = { name: "Premium" };\nexport const policies = defineWorkflowExecutionPolicies((define) => {\n  return { premium: define(options) };\n});`,
        errors: [`${NAME_MESSAGE} (got "Premium")`, `${KEY_MESSAGE} (got "Premium")`],
      },
    ],
  });
});

describe("checks every returned object in a block body", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => {\n  if (extended) return { Premium: define() };\n  return { premium: define() };\n});`,
        errors: [`${NAME_MESSAGE} (got "Premium")`, `${KEY_MESSAGE} (got "Premium")`],
      },
    ],
  });
});

describe("accepts valid definitions, including the example project's", () => {
  runRuleTests(RULE, {
    valid: [
      `${GROUP}export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({\n  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),\n  tenantApi: define({ name: "tenant-api", matchType: "prefix", concurrencyPolicy: { maxConcurrentExecutions: 3 } }),\n}));`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ "tenant-api": define({ key: "tenant:api.v1" }), a1b: define() }));`,
      `${SINGLE}export const policy = defineWorkflowExecutionPolicy("tenant-api", { matchType: "prefix", key: "t" });`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ key: "tenant-", matchType: "prefix" }) }));`,
    ],
  });
});

describe("skips values it cannot resolve statically", () => {
  runRuleTests(RULE, {
    valid: [
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: process.env.POLICY_NAME }) }));`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ premium: define({ name: "Premium", ...overrides }) }));`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => ({ [dynamicName]: define() }));`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies(buildPolicies);`,
      `${GROUP}const policies = { premium: define({ name: "Premium" }) };\nexport const group = defineWorkflowExecutionPolicies((define) => policies);`,
      `${GROUP}export const policies = defineWorkflowExecutionPolicies((define) => {\n  const define2 = (o: unknown) => define(o);\n  return { premium: define2({ name: "Premium" }) };\n});`,
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { defineWorkflowExecutionPolicies } from "another-sdk";\nexport const policies = defineWorkflowExecutionPolicies((define) => ({ Premium: define() }));',
    ],
  });
});
