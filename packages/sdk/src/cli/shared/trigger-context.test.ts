import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { transformFunctionTriggers } from "#/cli/services/workflow/trigger-transformer";
import { tempCwd } from "./test-helpers/temp-cwd";
import {
  buildTriggerContext,
  normalizeFilePath,
  serializeTriggerContext,
  type TriggerContext,
  type TriggerModuleBindings,
} from "./trigger-context";

describe("serializeTriggerContext", () => {
  function emptyContext(): TriggerContext {
    return {
      modules: new Map(),
    };
  }

  function bindings(localBindings: TriggerModuleBindings["localBindings"]) {
    return { localBindings, exports: new Map(localBindings) };
  }

  test("returns empty string for undefined", () => {
    expect(serializeTriggerContext(undefined)).toBe("");
  });

  test("returns deterministic output for empty maps", () => {
    const a = serializeTriggerContext(emptyContext());
    const b = serializeTriggerContext(emptyContext());

    expect(a).toBe(b);
    expect(a).toBe("[]null");
  });

  test("returns same output regardless of map insertion order", () => {
    const ctx1 = emptyContext();
    ctx1.modules.set(
      "/b",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowB" }]])),
    );
    ctx1.modules.set(
      "/a",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowA" }]])),
    );

    const ctx2 = emptyContext();
    ctx2.modules.set(
      "/a",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowA" }]])),
    );
    ctx2.modules.set(
      "/b",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowB" }]])),
    );

    expect(serializeTriggerContext(ctx1)).toBe(serializeTriggerContext(ctx2));
  });

  test("returns different output when map content differs", () => {
    const ctx1 = emptyContext();
    ctx1.modules.set("/jobs", bindings(new Map([["job1", { kind: "job", name: "ProcessOrder" }]])));

    const ctx2 = emptyContext();
    ctx2.modules.set(
      "/jobs",
      bindings(new Map([["job1", { kind: "job", name: "ProcessPayment" }]])),
    );

    expect(serializeTriggerContext(ctx1)).not.toBe(serializeTriggerContext(ctx2));
  });

  test("distinguishes entries in different maps", () => {
    const ctx1 = emptyContext();
    ctx1.modules.set("/module", bindings(new Map([["x", { kind: "workflow", name: "Name" }]])));

    const ctx2 = emptyContext();
    ctx2.modules.set("/module", bindings(new Map([["x", { kind: "job", name: "Name" }]])));

    expect(serializeTriggerContext(ctx1)).not.toBe(serializeTriggerContext(ctx2));
  });
});

describe("buildTriggerContext", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function createDuplicateExportContext() {
    const tempDir = mkdtempSync(path.join(tmpdir(), "trigger-context-"));
    tempDirs.push(tempDir);

    const firstPath = path.join(tempDir, "first.ts");
    const secondPath = path.join(tempDir, "second.ts");
    const firstSource = `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({
  name: "step-a",
  body: async () => "a",
});
`;
    const secondSource = `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({
  name: "step-b",
  body: async () => "b",
});
`;
    writeFileSync(firstPath, firstSource);
    writeFileSync(secondPath, secondSource);

    const context = await buildTriggerContext({ files: [firstPath, secondPath] });
    return { context, firstPath, firstSource, tempDir };
  }

  function transform(source: string, currentFilePath: string, context: TriggerContext) {
    return transformFunctionTriggers(source, context, currentFilePath);
  }

  function setModuleResolution(
    context: TriggerContext,
    baseUrl: string,
    paths: Record<string, string[]>,
  ) {
    context.moduleResolution = {
      path: path.join(baseUrl, "tsconfig.json"),
      config: { compilerOptions: { baseUrl, paths } },
    };
  }

  test("resolves duplicate local export names from the current module", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();

    const result = transform(`${firstSource}\nawait step.trigger();\n`, firstPath, context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain('tailor.workflow.triggerJobFunction("step-b"');
  });

  test("resolves aliased named imports", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step as importedStep } from "./first";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("resolves named imports through tsconfig path aliases", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    setModuleResolution(context, tempDir, { "@workflows/*": ["*"] });
    const source = `
import { step as importedStep } from "@workflows/first";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("resolves inherited path aliases relative to the declaring tsconfig", async () => {
    using temporary = tempCwd("trigger-context-");
    const tempDir = temporary.dir;
    const appDir = path.join(tempDir, "app");
    const configDir = path.join(tempDir, "config");
    const workflowsDir = path.join(configDir, "workflows");
    mkdirSync(appDir, { recursive: true });
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      path.join(configDir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { paths: { "@jobs/*": ["./workflows/*"] } } }),
    );
    writeFileSync(
      path.join(appDir, "tsconfig.json"),
      JSON.stringify({ extends: "../config/tsconfig.base.json" }),
    );
    const jobPath = path.join(workflowsDir, "job.ts");
    const callerPath = path.join(appDir, "caller.ts");
    writeFileSync(
      jobPath,
      `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`,
    );
    const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";
import { step as importedStep } from "@jobs/job";
export const caller = createWorkflowJob({
  name: "caller",
  body: async () => importedStep.trigger(),
});
`;
    writeFileSync(callerPath, source);
    process.chdir(appDir);
    const context = await buildTriggerContext({ files: [callerPath, jobPath] });

    const result = transform(source, callerPath, context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("uses the bundler tsconfig from the current working directory", async () => {
    using temporary = tempCwd("trigger-context-");
    const tempDir = temporary.dir;
    const nestedDir = path.join(tempDir, "nested");
    mkdirSync(nestedDir);
    writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@jobs": ["root-job"] } } }),
    );
    writeFileSync(
      path.join(nestedDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@jobs": ["nested-job"] } } }),
    );
    const rootJobPath = path.join(tempDir, "root-job.ts");
    const nestedJobPath = path.join(nestedDir, "nested-job.ts");
    const callerPath = path.join(nestedDir, "caller.ts");
    const jobSource = (name: string) => `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "${name}", body: async () => "done" });
`;
    writeFileSync(rootJobPath, jobSource("root-step"));
    writeFileSync(nestedJobPath, jobSource("nested-step"));
    const source = `
import { step as importedStep } from "@jobs";
await importedStep.trigger();
`;
    writeFileSync(callerPath, source);
    const context = await buildTriggerContext({
      files: [callerPath, rootJobPath, nestedJobPath],
    });

    const result = transform(source, callerPath, context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("root-step", undefined)');
    expect(result).not.toContain('tailor.workflow.triggerJobFunction("nested-step"');
  });

  test("does not apply baseUrl fallback when only tsconfig paths are configured", async () => {
    using temporary = tempCwd("trigger-context-");
    const tempDir = temporary.dir;
    writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@jobs/*": ["./workflows/*"] } } }),
    );
    const localJobPath = path.join(tempDir, "local-job.ts");
    writeFileSync(
      localJobPath,
      `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "wrong-step", body: async () => "wrong" });
`,
    );
    const context = await buildTriggerContext({ files: [localJobPath] });
    const source = `
import { step } from "local-job";
await step.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("await step.trigger()");
    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
  });

  test("resolves tsconfig path aliases that start with a hash", async () => {
    using temporary = tempCwd("trigger-context-");
    const tempDir = temporary.dir;
    const workflowsDir = path.join(tempDir, "workflows");
    mkdirSync(workflowsDir);
    writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "#jobs/*": ["./workflows/*"] } } }),
    );
    const jobPath = path.join(workflowsDir, "job.ts");
    writeFileSync(
      jobPath,
      `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`,
    );
    const context = await buildTriggerContext({ files: [jobPath] });
    const source = `
import { step as importedStep } from "#jobs/job";
await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("resolves jobs from namespace imports", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import * as jobs from "./first";

await jobs.step.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("jobs.step.trigger()");
  });

  test("removes a namespace import used only for a default workflow trigger", async () => {
    const { tempDir } = await createDuplicateExportContext();
    const workflowPath = path.join(tempDir, "workflow.ts");
    writeFileSync(
      workflowPath,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
const mainJob = createWorkflowJob({ name: "main-job", body: async () => "done" });
export const helper = () => "helper";
export default createWorkflow({ name: "workflow-a", mainJob });
`,
    );
    const context = await buildTriggerContext({ files: [workflowPath] });
    const source = `
import * as workflows from "./workflow";
await workflows.default.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);
    const retainedResult = transform(
      `${source}\nconsole.log(workflows);\n`,
      path.join(tempDir, "retained-caller.ts"),
      context,
    );
    const aliasedResult = transform(
      `
import { default as firstWorkflow, default as secondWorkflow, helper } from "./workflow";
helper();
await firstWorkflow.trigger();
await secondWorkflow.trigger();
`,
      path.join(tempDir, "aliased-caller.ts"),
      context,
    );

    expect(result).not.toContain('import * as workflows from "./workflow"');
    expect(result).toContain('tailor.workflow.triggerWorkflow("workflow-a", undefined)');
    expect(retainedResult).toContain('import * as workflows from "./workflow"');
    expect(aliasedResult).toContain('import { helper } from "./workflow"');
    expect(aliasedResult).not.toContain("default as");
  });

  test("does not transform an imported job name shadowed by a parameter", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

async function run(step: { trigger(): Promise<string> }) {
  return await step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("return await step.trigger()");
    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
  });

  test("does not transform an imported job name shadowed by a local variable", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

async function run() {
  const step = {
    trigger: async () => "local",
  };
  return await step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("return await step.trigger()");
    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
  });

  test("does not transform a job name shadowed inside a TypeScript namespace", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

namespace Local {
  const step = { trigger: async () => "local" };
  export async function run() {
    return step.trigger();
  }
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("return step.trigger()");
    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
  });

  test("resolves trigger bindings used by parameter decorators", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

class Consumer {
  run(@decorate(step.trigger()) step: unknown) {
    return step;
  }
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('decorate((async () => tailor.workflow.triggerJobFunction("step-a"');
    expect(result).toContain("return step");
  });

  test("keeps nested TypeScript namespace bindings in their own scope", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

namespace WithDeclaration {
  namespace step {
    export function trigger() {}
  }
  step.trigger({ source: "declaration" });
}

namespace WithNestedVar {
  export function run() {
    return step.trigger({ source: "outer" });
  }
  namespace Inner {
    var step = { trigger: async () => "local" };
    step.trigger({ source: "inner" });
  }
}

namespace WithImportEquals {
  import step = Other.step;
  step.trigger({ source: "import-equals" });
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('step.trigger({ source: "declaration" })');
    expect(result).toContain('step.trigger({ source: "inner" })');
    expect(result).toContain('step.trigger({ source: "import-equals" })');
    expect(result).toContain('triggerJobFunction("step-a", { source: "outer" })');
  });

  test("escapes job and workflow names in generated calls", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();
    const currentModule = context.modules.get(normalizeFilePath(firstPath));
    const jobName = 'step"\\quoted';
    currentModule?.localBindings.set("step", { kind: "job", name: jobName });
    const jobResult = transform(`${firstSource}\nawait step.trigger();\n`, firstPath, context);

    const workflowPath = path.join(path.dirname(firstPath), "workflow.ts");
    const workflowName = 'workflow"\\quoted';
    const workflowContext: TriggerContext = {
      modules: new Map([
        [
          normalizeFilePath(workflowPath),
          {
            localBindings: new Map([
              ["workflow", { kind: "workflow" as const, name: workflowName }],
            ]),
            exports: new Map(),
          },
        ],
      ]),
    };
    const workflowResult = transform("await workflow.trigger();", workflowPath, workflowContext);

    expect(jobResult).toContain(`triggerJobFunction(${JSON.stringify(jobName)}, undefined)`);
    expect(workflowResult).toContain(`triggerWorkflow(${JSON.stringify(workflowName)}, undefined)`);
  });

  test("serializes the effective base directory of inherited path aliases", async () => {
    using temporary = tempCwd("trigger-context-");
    const firstBaseDir = path.join(temporary.dir, "first-base");
    const secondBaseDir = path.join(temporary.dir, "second-base");
    mkdirSync(firstBaseDir);
    mkdirSync(secondBaseDir);
    const baseConfig = JSON.stringify({
      compilerOptions: { paths: { "@jobs/*": ["./jobs/*"] } },
    });
    writeFileSync(path.join(firstBaseDir, "tsconfig.json"), baseConfig);
    writeFileSync(path.join(secondBaseDir, "tsconfig.json"), baseConfig);
    const intermediateConfigPath = path.join(temporary.dir, "tsconfig.shared.json");
    writeFileSync(
      intermediateConfigPath,
      JSON.stringify({ extends: "./first-base/tsconfig.json" }),
    );
    writeFileSync(
      path.join(temporary.dir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.shared.json" }),
    );
    const workflowPath = path.join(temporary.dir, "workflow.ts");
    writeFileSync(workflowPath, "");
    const firstContext = await buildTriggerContext({ files: [workflowPath] });

    writeFileSync(
      intermediateConfigPath,
      JSON.stringify({ extends: "./second-base/tsconfig.json" }),
    );
    const secondContext = await buildTriggerContext({ files: [workflowPath] });

    expect(serializeTriggerContext(firstContext)).not.toBe(serializeTriggerContext(secondContext));
  });

  test("resolves switch discriminants outside case lexical bindings", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

switch (await step.trigger()) {
  case "local":
    const step = { trigger: async () => "local" };
    await step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result.match(/tailor\.workflow\.triggerJobFunction/g)).toHaveLength(1);
    expect(result).toContain("await step.trigger()");
  });

  test("keeps body var bindings out of default parameter initializers", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

function run(value = step.trigger()) {
  var step = { trigger: async () => "local" };
  return step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result.match(/tailor\.workflow\.triggerJobFunction/g)).toHaveLength(1);
    expect(result).toContain("return step.trigger()");
  });

  test("does not transform class-expression or static-block bindings", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

const JobClass = class step {
  static run() {
    return step.trigger();
  }
};

class Container {
  static {
    const step = { trigger: async () => "local" };
    step.trigger();
  }
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
    expect(result.match(/step\.trigger\(\)/g)).toHaveLength(2);
  });

  test("keeps static-block var bindings inside their static block", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";

class TopLevelContainer {
  static {
    var step = { trigger: async () => "local" };
    step.trigger({ source: "top" });
  }
}

async function run() {
  class NestedContainer {
    static {
      var step = { trigger: async () => "local" };
      step.trigger({ source: "nested" });
    }
  }
  return step.trigger({ source: "outer" });
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result.match(/tailor\.workflow\.triggerJobFunction/g)).toHaveLength(1);
    expect(result).toContain('step.trigger({ source: "top" })');
    expect(result).toContain('step.trigger({ source: "nested" })');
    expect(result).toContain('triggerJobFunction("step-a", { source: "outer" })');
  });

  test("does not transform a local object with a trigger method", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
const step = {
  trigger: async () => "local",
};

await step.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("await step.trigger()");
    expect(result).not.toContain("tailor.workflow.triggerJobFunction");
  });
});
