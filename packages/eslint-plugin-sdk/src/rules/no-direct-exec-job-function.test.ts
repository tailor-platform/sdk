/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, test } from "vitest";
import { expectClean, expectViolation } from "./test-helpers.js";

const RULE = "no-direct-exec-job-function";
const MESSAGE = "Do not call execJobFunction directly";

describe("no-direct-exec-job-function", () => {
  test("rejects calls on the ambient tailor.workflow global", () => {
    expectViolation(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const parent = createWorkflowJob({ name: "parent", body: () => tailor.workflow.execJobFunction("child", {}) });',
      RULE,
      MESSAGE,
    );
    expectViolation(
      "export const run = () => tailor.workflow.execJobFunction(name, {});",
      RULE,
      MESSAGE,
    );
  });

  test.each(["@tailor-platform/sdk/runtime", "@tailor-platform/sdk/runtime/workflow"])(
    "rejects calls on the workflow value imported from %s",
    (specifier) => {
      expectViolation(
        `import { workflow } from "${specifier}";\nexport const run = () => workflow.execJobFunction("child", {});`,
        RULE,
        MESSAGE,
      );
      expectViolation(
        `import { workflow as wf } from "${specifier}";\nexport const run = () => wf.execJobFunction("child", {});`,
        RULE,
        MESSAGE,
      );
      expectViolation(
        `import * as runtime from "${specifier}";\nexport const run = () => runtime.workflow.execJobFunction("child", {});`,
        RULE,
        MESSAGE,
      );
    },
  );

  test("accepts .start() calls and unrelated execJobFunction members", () => {
    expectClean(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });\nexport const parent = createWorkflowJob({ name: "parent", body: () => child.start() });',
      RULE,
    );
    expectClean(
      'import { workflow } from "another-runtime";\nworkflow.execJobFunction("child", {});',
      RULE,
    );
    expectClean('const workflow = createMock();\nworkflow.execJobFunction("child", {});', RULE);
    expectClean(
      'function run(tailor: Runtime) {\n  return tailor.workflow.execJobFunction("child", {});\n}',
      RULE,
    );
    expectClean(
      'import { tailor } from "another-runtime";\ntailor.workflow.execJobFunction("child", {});',
      RULE,
    );
    expectClean(
      'import { workflow } from "@tailor-platform/sdk/runtime";\nworkflow.startWorkflow("wf", {});',
      RULE,
    );
  });
});
