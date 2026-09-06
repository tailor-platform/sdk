/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "valid-workflow-exports";
const IMPORT = 'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\n';
const MAIN = `${IMPORT}export const main = createWorkflowJob({ name: "main", body: () => 1 });\n`;
const WORKFLOW_NOT_DEFAULT = "createWorkflow's result must be the module's default export";
const WORKFLOW_NAMED = "createWorkflow's result must not be a named export";
const JOB_NOT_EXPORTED = "createWorkflowJob's result must be a named export";
const JOB_DEFAULT = "createWorkflowJob's result must not be the default export";

describe("valid-workflow-exports", () => {
  test("rejects a workflow that is not default-exported", () => {
    expectViolation(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
      WORKFLOW_NOT_DEFAULT,
    );
    expectViolation(
      `${MAIN}export const workflow = createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
      WORKFLOW_NAMED,
    );
    expectViolation(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport { workflow };`,
      RULE,
      WORKFLOW_NAMED,
    );
    expectViolation(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow;\nexport { workflow as wf };`,
      RULE,
      WORKFLOW_NAMED,
    );
    expectViolation(
      `${MAIN}export const workflows = [createWorkflow({ name: "wf", mainJob: main })];`,
      RULE,
      WORKFLOW_NOT_DEFAULT,
    );
  });

  test("rejects a job that is not a named export", () => {
    expectViolation(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
      JOB_NOT_EXPORTED,
    );
    expectViolation(
      `${IMPORT}export default createWorkflow({ name: "wf", mainJob: createWorkflowJob({ name: "main", body: () => 1 }) });`,
      RULE,
      JOB_NOT_EXPORTED,
    );
    expectViolation(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport type { main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
      JOB_NOT_EXPORTED,
    );
    expectViolation(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { type main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
      JOB_NOT_EXPORTED,
    );
    expectViolation(
      `${IMPORT}export default createWorkflowJob({ name: "main", body: () => 1 });`,
      RULE,
      JOB_DEFAULT,
    );
    expectViolation(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main as default };`,
      RULE,
      JOB_DEFAULT,
    );
    expectViolation(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main, main as default };`,
      RULE,
      JOB_DEFAULT,
    );
  });

  test("accepts the documented export shapes", () => {
    expectClean(`${MAIN}export default createWorkflow({ name: "wf", mainJob: main });`, RULE);
    expectClean(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow;`,
      RULE,
    );
    expectClean(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main }) satisfies object;\nexport { workflow as default };`,
      RULE,
    );
    expectClean(
      `${MAIN}export default (createWorkflow({ name: "wf", mainJob: main }) as object) satisfies object;`,
      RULE,
    );
    expectClean(
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow as object;`,
      RULE,
    );
    expectClean(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
    );
    expectClean(
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main as mainJob };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      RULE,
    );
    expectClean(
      `import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });`,
      RULE,
    );
  });

  test("ignores definitions built inside functions", () => {
    expectClean(
      `${IMPORT}function makeJob() {\n  return createWorkflowJob({ name: "main", body: () => 1 });\n}\nexport const main = makeJob();\nfunction makeWorkflow() {\n  return createWorkflow({ name: "wf", mainJob: main });\n}\nexport default makeWorkflow();`,
      RULE,
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createWorkflow, createWorkflowJob } from "another-sdk";\nconst main = createWorkflowJob({ name: "main", body: () => 1 });\nexport const workflow = createWorkflow({ name: "wf", mainJob: main });',
      RULE,
    );
  });
});
