/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "valid-workflow-job-definition";
const IMPORT = 'import { createWorkflowJob } from "@tailor-platform/sdk";\n';

describe("valid-workflow-job-definition", () => {
  test("rejects options that are not an inline object literal", () => {
    expectViolation(
      `${IMPORT}const options = { name: "job", body: () => 1 };\nexport const job = createWorkflowJob(options);`,
      RULE,
      "createWorkflowJob's options must be an inline object literal",
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob(buildOptions());`,
      RULE,
      "createWorkflowJob's options must be an inline object literal",
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob();`,
      RULE,
      "createWorkflowJob's options must be an inline object literal",
    );
  });

  test("rejects a missing or non-literal name", () => {
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ body: () => 1 });`,
      RULE,
      'createWorkflowJob\'s "name" must be a string literal',
    );
    expectViolation(
      `${IMPORT}const name = "job";\nexport const job = createWorkflowJob({ name, body: () => 1 });`,
      RULE,
      'createWorkflowJob\'s "name" must be a string literal',
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ name: \`job-\${suffix}\`, body: () => 1 });`,
      RULE,
      'createWorkflowJob\'s "name" must be a string literal',
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ name: \`job\`, body: () => 1 });`,
      RULE,
      'createWorkflowJob\'s "name" must be a string literal',
    );
  });

  test("rejects a missing or non-inline body", () => {
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ name: "job" });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
    expectViolation(
      `${IMPORT}const run = () => 1;\nexport const job = createWorkflowJob({ name: "job", body: run });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: withLogging(() => 1) });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
    expectViolation(
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: (() => 1) as () => number });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
  });

  test("checks calls through aliases, namespaces, and nested scopes", () => {
    expectViolation(
      `import { createWorkflowJob as defineJob } from "@tailor-platform/sdk";\nexport const job = defineJob({ name: "job", body: run });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
    expectViolation(
      `import * as sdk from "@tailor-platform/sdk";\nexport const job = sdk.createWorkflowJob({ name: "job", body: run });`,
      RULE,
      'createWorkflowJob\'s "body" must be an inline function expression',
    );
    expectViolation(
      `${IMPORT}function makeJob(name: string) {\n  return createWorkflowJob({ name, body: () => 1 });\n}\nexport const job = makeJob("job");`,
      RULE,
      'createWorkflowJob\'s "name" must be a string literal',
    );
  });

  test("accepts statically detectable definitions", () => {
    expectClean(
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: async (input: { id: string }) => input.id });`,
      RULE,
    );
    expectClean(
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: function (input: { id: string }) { return input.id; } });`,
      RULE,
    );
    expectClean(
      `${IMPORT}export const job = createWorkflowJob({ "name": "job", body: () => 1, publishEvents: true });`,
      RULE,
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createWorkflowJob } from "another-sdk";\nexport const job = createWorkflowJob(options);',
      RULE,
    );
  });
});
