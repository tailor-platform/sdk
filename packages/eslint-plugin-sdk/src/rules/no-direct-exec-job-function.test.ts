import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-direct-exec-job-function";
const MESSAGE =
  "Do not call execJobFunction directly; a direct call is never detected as a job dependency, so the target job is dropped from the bundle. Call the target job's .start() from inside a job body instead.";

describe("rejects calls on the ambient tailor.workflow global", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const parent = createWorkflowJob({ name: "parent", body: () => tailor.workflow.execJobFunction("child", {}) });',
        errors: [MESSAGE],
      },
      {
        code: "export const run = () => tailor.workflow.execJobFunction(name, {});",
        errors: [MESSAGE],
      },
    ],
  });
});

describe.each(["@tailor-platform/sdk/runtime", "@tailor-platform/sdk/runtime/workflow"])(
  "rejects calls on the workflow value imported from %s",
  (specifier) => {
    runRuleTests(RULE, {
      invalid: [
        `import { workflow } from "${specifier}";\nexport const run = () => workflow.execJobFunction("child", {});`,
        `import { workflow as wf } from "${specifier}";\nexport const run = () => wf.execJobFunction("child", {});`,
        `import * as runtime from "${specifier}";\nexport const run = () => runtime.workflow.execJobFunction("child", {});`,
      ].map((code) => ({ code, errors: [MESSAGE] })),
    });
  },
);

describe("accepts .start() calls and unrelated execJobFunction members", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const child = createWorkflowJob({ name: "child", body: () => 1 });\nexport const parent = createWorkflowJob({ name: "parent", body: () => child.start() });',
      'import { workflow } from "another-runtime";\nworkflow.execJobFunction("child", {});',
      'const workflow = createMock();\nworkflow.execJobFunction("child", {});',
      'function run(tailor: Runtime) {\n  return tailor.workflow.execJobFunction("child", {});\n}',
      'import { tailor } from "another-runtime";\ntailor.workflow.execJobFunction("child", {});',
      'import { workflow } from "@tailor-platform/sdk/runtime";\nworkflow.startWorkflow("wf", {});',
    ],
  });
});
