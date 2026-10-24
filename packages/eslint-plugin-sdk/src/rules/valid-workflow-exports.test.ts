import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "valid-workflow-exports";
const IMPORT = 'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\n';
const MAIN = `${IMPORT}export const main = createWorkflowJob({ name: "main", body: () => 1 });\n`;
const WORKFLOW_NOT_DEFAULT =
  "createWorkflow's result must be the module's default export (export default createWorkflow(...)); a workflow that is not default-exported is never deployed.";
const WORKFLOW_NAMED =
  "createWorkflow's result must not be a named export; make it the module's default export instead. The build treats named exports as workflow jobs and fails to load the file.";
const JOB_NOT_EXPORTED =
  "createWorkflowJob's result must be a named export (export const job = createWorkflowJob(...)); the build only collects jobs from named exports.";
const JOB_DEFAULT =
  "createWorkflowJob's result must not be the default export; the default export is reserved for createWorkflow's result, and the build fails to load the file.";

describe("rejects a workflow that is not default-exported", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });`,
        errors: [WORKFLOW_NOT_DEFAULT],
      },
      {
        code: `${MAIN}export const workflow = createWorkflow({ name: "wf", mainJob: main });`,
        errors: [WORKFLOW_NAMED],
      },
      {
        code: `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport { workflow };`,
        errors: [WORKFLOW_NAMED],
      },
      {
        code: `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nconst alias = workflow;\nexport { alias };`,
        errors: [WORKFLOW_NAMED],
      },
      {
        code: `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport const alias = workflow;\nexport default workflow;`,
        errors: [WORKFLOW_NAMED],
      },
      {
        code: `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow;\nexport { workflow as wf };`,
        errors: [WORKFLOW_NAMED],
      },
      {
        code: `${MAIN}export const workflows = [createWorkflow({ name: "wf", mainJob: main })];`,
        errors: [WORKFLOW_NOT_DEFAULT],
      },
    ],
  });
});

describe("rejects a job that is not a named export", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport default createWorkflow({ name: "wf", mainJob: main });`,
        errors: [JOB_NOT_EXPORTED],
      },
      {
        code: `${IMPORT}export default createWorkflow({ name: "wf", mainJob: createWorkflowJob({ name: "main", body: () => 1 }) });`,
        errors: [JOB_NOT_EXPORTED],
      },
      {
        code: `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport type { main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
        errors: [JOB_NOT_EXPORTED],
      },
      {
        code: `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { type main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
        errors: [JOB_NOT_EXPORTED],
      },
      {
        code: `${IMPORT}export default createWorkflowJob({ name: "main", body: () => 1 });`,
        errors: [JOB_DEFAULT],
      },
      {
        code: `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main as default };`,
        errors: [JOB_DEFAULT],
      },
      {
        code: `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main, main as default };`,
        errors: [JOB_DEFAULT],
      },
    ],
  });
});

describe("accepts the documented export shapes", () => {
  runRuleTests(RULE, {
    valid: [
      `${MAIN}export default createWorkflow({ name: "wf", mainJob: main });`,
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow;`,
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main }) satisfies object;\nexport { workflow as default };`,
      `${MAIN}export default (createWorkflow({ name: "wf", mainJob: main }) as object) satisfies object;`,
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nexport default workflow as object;`,
      `${MAIN}const workflow = createWorkflow({ name: "wf", mainJob: main });\nconst alias = workflow;\nexport default alias;`,
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport { main as mainJob };\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      `${IMPORT}const main = createWorkflowJob({ name: "main", body: () => 1 });\nexport const mainJob = main;\nexport default createWorkflow({ name: "wf", mainJob: main });`,
      `import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });`,
    ],
  });
});

describe("ignores definitions built inside functions", () => {
  runRuleTests(RULE, {
    valid: [
      `${IMPORT}function makeJob() {\n  return createWorkflowJob({ name: "main", body: () => 1 });\n}\nexport const main = makeJob();\nfunction makeWorkflow() {\n  return createWorkflow({ name: "wf", mainJob: main });\n}\nexport default makeWorkflow();`,
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createWorkflow, createWorkflowJob } from "another-sdk";\nconst main = createWorkflowJob({ name: "main", body: () => 1 });\nexport const workflow = createWorkflow({ name: "wf", mainJob: main });',
    ],
  });
});
