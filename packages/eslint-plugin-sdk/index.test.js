/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";
import { afterEach, describe, expect, test } from "vitest";
import plugin from "./index.js";

const packageDir = dirname(fileURLToPath(import.meta.url));
const oxlintBin = resolve(packageDir, "../../node_modules/.bin/oxlint");
const pluginUrl = pathToFileURL(resolve(packageDir, "index.js")).href;
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function lint(source, rule, filename = "fixture.ts") {
  const dir = mkdtempSync(join(tmpdir(), "tailor-sdk-lint-"));
  tempDirs.push(dir);
  const file = join(dir, filename);
  const config = join(dir, ".oxlintrc.json");

  writeFileSync(file, source);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "tailor-sdk", specifier: pluginUrl }],
      rules: { [`tailor-sdk/${rule}`]: "error" },
    }),
  );

  const result = spawnSync(oxlintBin, ["--config", config, file], {
    cwd: dir,
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function expectViolation(source, rule, message, filename) {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 1 });
  expect(result.output).toContain(`tailor-sdk(${rule})`);
  expect(result.output).toContain(message);
}

function expectClean(source, rule, filename) {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 0 });
}

describe("plugin", () => {
  test("exports every rule in the recommended ESLint flat config", () => {
    expect(Object.keys(plugin.rules).toSorted()).toEqual([
      "no-api-prefix-in-path-pattern",
      "no-deprecated-api",
      "no-resume-after-resolve",
      "one-service-per-file",
      "require-named-workflow-job-export",
      "require-service-default-export",
    ]);
    expect(plugin.configs.recommended.plugins["tailor-sdk"]).toBe(plugin);
    expect(Object.keys(plugin.configs.recommended.rules)).toHaveLength(6);
    expect(plugin.configs.recommended.rules["tailor-sdk/no-resume-after-resolve"]).toBe("warn");
    expect(plugin.configs.recommended.rules["tailor-sdk/require-service-default-export"]).toBe(
      "error",
    );
  });

  test("runs through the ESLint v9 recommended flat config", () => {
    const messages = new Linter().verify(
      'import { createResolver } from "@tailor-platform/sdk";\nexport const resolver = createResolver({});',
      [plugin.configs.recommended],
      { filename: "resolver.js" },
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "tailor-sdk/require-service-default-export",
          severity: 2,
        }),
      ]),
    );
  });
});

describe("require-service-default-export", () => {
  test.each([
    ["createResolver", "resolver"],
    ["createExecutor", "executor"],
    ["createHttpAdapter", "HTTP adapter"],
    ["createWorkflow", "workflow"],
  ])("requires %s results to be default exports", (factory, service) => {
    expectViolation(
      `import { ${factory} as defineService } from "@tailor-platform/sdk";\nexport const service = defineService({});`,
      "require-service-default-export",
      `The ${service} created by ${factory}() must be the default export.`,
    );
  });

  test("accepts direct and identifier default exports", () => {
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({});',
      "require-service-default-export",
    );
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nconst resolver = createResolver({});\nexport { resolver as default };',
      "require-service-default-export",
    );
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nexport default (createResolver({}) satisfies unknown);',
      "require-service-default-export",
    );
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nconst resolver = createResolver({});\nexport default (resolver satisfies unknown);',
      "require-service-default-export",
    );
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nconst resolver = createResolver({});\nconst entry = resolver;\nexport default entry;',
      "require-service-default-export",
    );
  });

  test("supports namespace imports", () => {
    expectViolation(
      'import * as sdk from "@tailor-platform/sdk";\nexport const resolver = sdk.createResolver({});',
      "require-service-default-export",
      "The resolver created by createResolver() must be the default export.",
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createResolver } from "another-sdk";\nexport const resolver = createResolver({});',
      "require-service-default-export",
    );
  });

  test("ignores SDK import names shadowed by function parameters", () => {
    expectClean(
      'import { createResolver } from "@tailor-platform/sdk";\nfunction helper(createResolver) { return createResolver({}); }',
      "require-service-default-export",
    );
    expectClean(
      'import * as sdk from "@tailor-platform/sdk";\nfunction helper(sdk) { return sdk.createResolver({}); }',
      "require-service-default-export",
    );
  });

  test("rejects a service nested inside a default-exported object", () => {
    expectViolation(
      'import { createResolver } from "@tailor-platform/sdk";\nexport default { resolver: createResolver({}) };',
      "require-service-default-export",
      "The resolver created by createResolver() must be the default export.",
    );
  });
});

describe("require-named-workflow-job-export", () => {
  test("rejects unexported and default-exported jobs", () => {
    expectViolation(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nconst job = createWorkflowJob({});',
      "require-named-workflow-job-export",
      "The job created by createWorkflowJob() must be a named export.",
    );
    expectViolation(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport default createWorkflowJob({});',
      "require-named-workflow-job-export",
      "The job created by createWorkflowJob() must be a named export.",
    );
  });

  test("accepts direct and later named exports", () => {
    expectClean(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const job = createWorkflowJob({});',
      "require-named-workflow-job-export",
    );
    expectClean(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nconst job = createWorkflowJob({});\nexport { job };',
      "require-named-workflow-job-export",
    );
    expectClean(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nconst job = createWorkflowJob({});\nconst entry = job;\nexport { entry };',
      "require-named-workflow-job-export",
    );
    expectClean(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nconst job = createWorkflowJob({});\nexport const entry = job satisfies unknown;',
      "require-named-workflow-job-export",
    );
  });

  test("does not treat a re-export from another module as a local job export", () => {
    expectViolation(
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nconst job = createWorkflowJob({});\nexport { job } from "./other";',
      "require-named-workflow-job-export",
      "The job created by createWorkflowJob() must be a named export.",
    );
  });
});

describe("one-service-per-file", () => {
  test("rejects multiple deployable services", () => {
    expectViolation(
      'import * as sdk from "@tailor-platform/sdk";\nexport const first = sdk.createExecutor({});\nexport default sdk.createExecutor({});',
      "one-service-per-file",
      "Only one deployable service may be defined in a file; found 2.",
    );
  });

  test("does not count workflow jobs as deployable services", () => {
    expectClean(
      'import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";\nexport const first = createWorkflowJob({});\nexport const second = createWorkflowJob({});\nexport default createWorkflow({ mainJob: first });',
      "one-service-per-file",
    );
  });
});

describe("no-api-prefix-in-path-pattern", () => {
  test.each(['"/api/users/*"', "`/api/orders`"])(
    "rejects the external /api prefix in %s",
    (pattern) => {
      expectViolation(
        `import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: ${pattern} });`,
        "no-api-prefix-in-path-pattern",
        "pathPattern is matched after the /api prefix; remove the leading /api.",
      );
    },
  );

  test("accepts relative platform paths and dynamic values", () => {
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/users/*" });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern });',
      "no-api-prefix-in-path-pattern",
    );
    expectClean(
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ pathPattern: "/api/users", pathPattern: "/users" });',
      "no-api-prefix-in-path-pattern",
    );
  });
});

describe("no-deprecated-api", () => {
  test("rejects defineGenerators and SDK auth invoker calls", () => {
    expectViolation(
      'import { defineGenerators as generators } from "@tailor-platform/sdk";\nexport const value = generators();',
      "no-deprecated-api",
      "defineGenerators() is deprecated; use definePlugins() instead.",
    );
    expectViolation(
      'import { auth } from "../tailor.config";\nexport const invoker = auth.invoker("automation");',
      "no-deprecated-api",
      "auth.invoker() is deprecated; pass the machine-user name as a string.",
    );
    expectViolation(
      'import { defineAuth } from "@tailor-platform/sdk";\nconst auth = defineAuth("main", {});\nexport const invoker = auth.invoker("automation");',
      "no-deprecated-api",
      "auth.invoker() is deprecated; pass the machine-user name as a string.",
    );
    expectViolation(
      'import config from "../tailor.config";\nexport const invoker = config.auth.invoker("automation");',
      "no-deprecated-api",
      "auth.invoker() is deprecated; pass the machine-user name as a string.",
    );
  });

  test("ignores unrelated invoker methods", () => {
    expectClean(
      'import { client } from "another-sdk";\nexport const invoker = client.invoker("automation");',
      "no-deprecated-api",
    );
    expectClean(
      'import { client } from "../tailor.config";\nexport const invoker = client.invoker("automation");',
      "no-deprecated-api",
    );
    expectClean(
      'import { startWorkflow } from "@tailor-platform/sdk/cli";\nimport config from "../tailor.config";\nstartWorkflow({ workflow, authInvoker: config.auth.invoker("automation"), arg: {} });',
      "no-deprecated-api",
    );
  });
});

describe("no-resume-after-resolve", () => {
  test("rejects resuming the same execution after resolving it", () => {
    expectViolation(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  await approval.resolve(input.executionId, () => true);\n  await resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
      "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    );
  });

  test("accepts different execution IDs and unrelated resume functions", () => {
    expectClean(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  await approval.resolve(input.executionId, () => true);\n  await resumeWorkflow(input.retryExecutionId);\n}',
      "no-resume-after-resolve",
    );
    expectClean(
      'import { resumeWorkflow } from "another-sdk";\nasync function decide(input) {\n  await approval.resolve(input.executionId, () => true);\n  await resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
    );
    expectClean(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  cache.resolve(input.executionId, true);\n  await resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
    );
    expectClean(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide() {\n  await approval.resolve("run 1", () => true);\n  await resumeWorkflow("run1");\n}',
      "no-resume-after-resolve",
    );
  });

  test("does not report a conditional resolve", () => {
    expectClean(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  if (input.shouldResolve) await approval.resolve(input.executionId, () => true);\n  await resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
    );
  });

  test("supports aliased workflow runtime imports", () => {
    expectViolation(
      'import { resolve as signal, resumeWorkflow as resume } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  await signal(input.executionId, "approval", () => true);\n  await resume(input.executionId);\n}',
      "no-resume-after-resolve",
      "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    );
  });

  test("rejects assigning the redundant resume result", () => {
    expectViolation(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  await approval.resolve(input.executionId, () => true);\n  const resumedExecutionId = await resumeWorkflow(input.executionId);\n  return resumedExecutionId;\n}',
      "no-resume-after-resolve",
      "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    );
  });

  test("rejects a redundant resume after assigning the resolve result", () => {
    expectViolation(
      'import { resumeWorkflow } from "@tailor-platform/sdk/runtime/workflow";\nasync function decide(input) {\n  result = await approval.resolve(input.executionId, () => true);\n  await resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
      "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    );
  });

  test("supports the workflow namespace from the runtime root", () => {
    expectViolation(
      'import * as runtime from "@tailor-platform/sdk/runtime";\nasync function decide(input) {\n  await approval.resolve(input.executionId, () => true);\n  await runtime.workflow.resumeWorkflow(input.executionId);\n}',
      "no-resume-after-resolve",
      "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    );
  });
});
