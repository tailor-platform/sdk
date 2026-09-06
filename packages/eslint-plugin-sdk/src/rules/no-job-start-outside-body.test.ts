/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "no-job-start-outside-body";
const MESSAGE = "is not inside any workflow job's body";
const IMPORT = 'import { createWorkflowJob } from "@tailor-platform/sdk";\n';
const CHILD = `${IMPORT}export const child = createWorkflowJob({ name: "child", body: () => 1 });\n`;

describe("no-job-start-outside-body", () => {
  test("rejects a start call factored into a module-level function", () => {
    expectViolation(
      `${CHILD}function runChild() {\n  return child.start();\n}\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
      RULE,
      MESSAGE,
    );
    expectViolation(
      `${CHILD}const runChild = () => child.start();\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
      RULE,
      MESSAGE,
    );
  });

  test("rejects a start call at module scope", () => {
    expectViolation(`${CHILD}export const result = child.start();`, RULE, MESSAGE);
  });

  test("reports the stray call while accepting the in-body one", () => {
    expectViolation(
      `${CHILD}export const parent = createWorkflowJob({ name: "parent", body: () => child.start() });\nexport const stray = child.start();`,
      RULE,
      MESSAGE,
    );
  });

  test("resolves the started job through a const alias", () => {
    expectViolation(
      `${CHILD}const alias = child;\nexport const result = alias.start();`,
      RULE,
      MESSAGE,
    );
  });

  test("accepts start calls lexically inside a job body", () => {
    expectClean(
      `${CHILD}export const parent = createWorkflowJob({ name: "parent", body: () => child.start() });`,
      RULE,
    );
    expectClean(
      `${CHILD}export const parent = createWorkflowJob({\n  name: "parent",\n  body: () => {\n    const run = () => child.start();\n    return run();\n  },\n});`,
      RULE,
    );
    expectClean(
      `${CHILD}export const parent = createWorkflowJob({\n  name: "parent",\n  body: async () => {\n    for (const _ of [1, 2]) {\n      await Promise.resolve(child.start());\n    }\n  },\n});`,
      RULE,
    );
  });

  test("ignores start calls on values that are not same-file jobs", () => {
    expectClean(
      `${IMPORT}import { child } from "./child";\nfunction runChild() {\n  return child.start();\n}\nexport const parent = createWorkflowJob({ name: "parent", body: () => runChild() });`,
      RULE,
    );
    expectClean(
      `import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\nexport const main = createWorkflowJob({ name: "main", body: () => 1 });\nconst workflow = createWorkflow({ name: "wf", mainJob: main });\nexport const run = () => workflow.start({});\nexport default workflow;`,
      RULE,
    );
    expectClean(`const timer = createTimer();\ntimer.start();`, RULE);
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createWorkflowJob } from "another-sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });\nexport const result = child.start();',
      RULE,
    );
  });
});
