import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-job-start-outside-body";
const MESSAGE =
  "child.start() is not inside any workflow job's body; dependency detection only sees .start() calls lexically inside a body, so move the call (or the function containing it) into the calling job's body.";
const IMPORT = 'import { createWorkflowJob } from "@tailor-platform/sdk";\n';
const CHILD = `${IMPORT}export const child = createWorkflowJob({ name: "child", body: () => 1 });\n`;

describe("rejects a start call factored into a module-level function", () => {
  runRuleTests(RULE, {
    invalid: [
      `${CHILD}function runChild() {\n  return child.start();\n}\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
      `${CHILD}const runChild = () => child.start();\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
    ].map((code) => ({ code, errors: [MESSAGE] })),
  });
});

describe("rejects a start call at module scope", () => {
  runRuleTests(RULE, {
    invalid: [{ code: `${CHILD}export const result = child.start();`, errors: [MESSAGE] }],
  });
});

describe("reports the stray call while accepting the in-body one", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${CHILD}export const parent = createWorkflowJob({ name: "parent", body: () => child.start() });\nexport const stray = child.start();`,
        errors: [MESSAGE],
      },
    ],
  });
});

describe("ignores start calls through a const alias, which the build never rewrites", () => {
  runRuleTests(RULE, {
    valid: [`${CHILD}const alias = child;\nexport const result = alias.start();`],
  });
});

describe("accepts start calls lexically inside a job body", () => {
  runRuleTests(RULE, {
    valid: [
      `${CHILD}export const parent = createWorkflowJob({ name: "parent", body: () => child.start() });`,
      `${CHILD}export const parent = createWorkflowJob({\n  name: "parent",\n  body: () => {\n    const run = () => child.start();\n    return run();\n  },\n});`,
      `${CHILD}export const parent = createWorkflowJob({\n  name: "parent",\n  body: async () => {\n    for (const _ of [1, 2]) {\n      await Promise.resolve(child.start());\n    }\n  },\n});`,
    ],
  });
});

describe("ignores start calls on values that are not same-file jobs", () => {
  runRuleTests(RULE, {
    valid: [
      `${IMPORT}import { child } from "./child";\nfunction runChild() {\n  return child.start();\n}\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
      `import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\nexport const main = createWorkflowJob({ name: "main", body: () => 1 });\nconst workflow = createWorkflow({ name: "wf", mainJob: main });\nexport const run = () => workflow.start({});\nexport default workflow;`,
      `const timer = createTimer();\ntimer.start();`,
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createWorkflowJob } from "another-sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });\nexport const result = child.start();',
    ],
  });
});
