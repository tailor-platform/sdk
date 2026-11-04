import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "valid-workflow-job-definition";
const IMPORT = 'import { createWorkflowJob } from "@tailor-platform/sdk";\n';
const OPTIONS_NOT_LITERAL =
  "createWorkflowJob's options must be an inline object literal; the build cannot detect a job whose options come from a variable or call.";
const NAME_NOT_LITERAL =
  'createWorkflowJob\'s "name" must be a string literal; the build cannot detect a job whose name is a variable, template literal, or computed value.';
const BODY_NOT_FUNCTION =
  'createWorkflowJob\'s "body" must be an inline function expression; the build cannot bundle a body that is a variable or wrapped in another call.';

describe("rejects options that are not an inline object literal", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${IMPORT}const options = { name: "job", body: () => 1 };\nexport const job = createWorkflowJob(options);`,
        errors: [OPTIONS_NOT_LITERAL],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob(buildOptions());`,
        errors: [OPTIONS_NOT_LITERAL],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob();`,
        errors: [OPTIONS_NOT_LITERAL],
      },
    ],
  });
});

describe("rejects a missing or non-literal name", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${IMPORT}export const job = createWorkflowJob({ body: () => 1 });`,
        errors: [NAME_NOT_LITERAL],
      },
      {
        code: `${IMPORT}const name = "job";\nexport const job = createWorkflowJob({ name, body: () => 1 });`,
        errors: [NAME_NOT_LITERAL],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob({ name: \`job-\${suffix}\`, body: () => 1 });`,
        errors: [NAME_NOT_LITERAL],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob({ name: \`job\`, body: () => 1 });`,
        errors: [NAME_NOT_LITERAL],
      },
    ],
  });
});

describe("rejects a missing or non-inline body", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${IMPORT}export const job = createWorkflowJob({ name: "job" });`,
        errors: [BODY_NOT_FUNCTION],
      },
      {
        code: `${IMPORT}const run = () => 1;\nexport const job = createWorkflowJob({ name: "job", body: run });`,
        errors: [BODY_NOT_FUNCTION],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob({ name: "job", body: withLogging(() => 1) });`,
        errors: [BODY_NOT_FUNCTION],
      },
      {
        code: `${IMPORT}export const job = createWorkflowJob({ name: "job", body: (() => 1) as () => number });`,
        errors: [BODY_NOT_FUNCTION],
      },
    ],
  });
});

describe("checks calls through aliases, namespaces, and nested scopes", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `import { createWorkflowJob as defineJob } from "@tailor-platform/sdk";\nexport const job = defineJob({ name: "job", body: run });`,
        errors: [BODY_NOT_FUNCTION],
      },
      {
        code: `import * as sdk from "@tailor-platform/sdk";\nexport const job = sdk.createWorkflowJob({ name: "job", body: run });`,
        errors: [BODY_NOT_FUNCTION],
      },
      {
        code: `${IMPORT}function makeJob(name: string) {\n  return createWorkflowJob({ name, body: () => 1 });\n}\nexport const job = makeJob("job");`,
        errors: [NAME_NOT_LITERAL],
      },
    ],
  });
});

describe("accepts statically detectable definitions", () => {
  runRuleTests(RULE, {
    valid: [
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: async (input: { id: string }) => input.id });`,
      `${IMPORT}export const job = createWorkflowJob({ name: "job", body: function (input: { id: string }) { return input.id; } });`,
      `${IMPORT}export const job = createWorkflowJob({ "name": "job", body: () => 1, publishEvents: true });`,
      `${IMPORT}const defaults = { publishEvents: true };\nexport const job = createWorkflowJob({ ...defaults, name: "job", body: () => 1 });`,
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createWorkflowJob } from "another-sdk";\nexport const job = createWorkflowJob(options);',
    ],
  });
});
