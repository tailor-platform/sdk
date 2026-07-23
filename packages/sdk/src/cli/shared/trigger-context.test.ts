import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { transformFunctionTriggers } from "#/cli/services/workflow/trigger-transformer";
import {
  buildTriggerContext,
  normalizeFilePath,
  serializeTriggerContext,
  type TriggerContext,
  type TriggerModuleBindings,
} from "./trigger-context";

describe("serializeTriggerContext", () => {
  function emptyContext(): TriggerContext {
    return { modules: new Map() };
  }

  function bindings(localBindings: TriggerModuleBindings["localBindings"]) {
    return { localBindings, exports: new Map(localBindings) };
  }

  test("returns empty string for undefined", () => {
    expect(serializeTriggerContext(undefined)).toBe("");
  });

  test("returns deterministic output for empty maps", () => {
    expect(serializeTriggerContext(emptyContext())).toBe("[]");
  });

  test("returns same output regardless of map insertion order", () => {
    const first = emptyContext();
    first.modules.set(
      "/b",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowB" }]])),
    );
    first.modules.set(
      "/a",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowA" }]])),
    );

    const second = emptyContext();
    second.modules.set(
      "/a",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowA" }]])),
    );
    second.modules.set(
      "/b",
      bindings(new Map([["workflow", { kind: "workflow", name: "WorkflowB" }]])),
    );

    expect(serializeTriggerContext(first)).toBe(serializeTriggerContext(second));
  });

  test("returns different output when map content differs", () => {
    const first = emptyContext();
    first.modules.set("/jobs", bindings(new Map([["job", { kind: "job", name: "ProcessOrder" }]])));
    const second = emptyContext();
    second.modules.set(
      "/jobs",
      bindings(new Map([["job", { kind: "job", name: "ProcessPayment" }]])),
    );

    expect(serializeTriggerContext(first)).not.toBe(serializeTriggerContext(second));
  });

  test("distinguishes entries in different maps", () => {
    const first = emptyContext();
    first.modules.set(
      "/module",
      bindings(new Map([["target", { kind: "workflow", name: "Name" }]])),
    );
    const second = emptyContext();
    second.modules.set("/module", bindings(new Map([["target", { kind: "job", name: "Name" }]])));

    expect(serializeTriggerContext(first)).not.toBe(serializeTriggerContext(second));
  });
});

describe("buildTriggerContext", () => {
  const tempDirs: string[] = [];

  aroundEach(async (runTest) => {
    await runTest();
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
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`;
    const secondSource = `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-b", body: async () => "b" });
`;
    writeFileSync(firstPath, firstSource);
    writeFileSync(secondPath, secondSource);
    const context = await buildTriggerContext({ files: [firstPath, secondPath] });
    return { context, firstPath, firstSource, tempDir };
  }

  function transform(source: string, currentFilePath: string, context: TriggerContext) {
    return transformFunctionTriggers(source, context, currentFilePath);
  }

  test("resolves duplicate local export names from the current module", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();

    const result = transform(`${firstSource}\nawait step.trigger();\n`, firstPath, context);

    expect(result).toContain('tailor.workflow.execJobFunction("step-a", undefined)');
    expect(result).not.toContain('tailor.workflow.execJobFunction("step-b"');
  });

  test("resolves aliased named imports", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step as importedStep } from "./first";
await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.execJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("resolves relative default workflow imports", async () => {
    const { tempDir } = await createDuplicateExportContext();
    const workflowPath = path.join(tempDir, "workflow.ts");
    writeFileSync(
      workflowPath,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
const mainJob = createWorkflowJob({ name: "main-job", body: async () => "done" });
export default createWorkflow({ name: "workflow-a", mainJob });
`,
    );
    const context = await buildTriggerContext({ files: [workflowPath] });
    const source = `
import workflow from "./workflow";
await workflow.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('import workflow from "./workflow"');
    expect(result).toContain('tailor.workflow.triggerWorkflow("workflow-a", undefined)');
  });

  test("preserves a namespace import paired with a transformed default import", async () => {
    const { tempDir } = await createDuplicateExportContext();
    const workflowPath = path.join(tempDir, "workflow.ts");
    writeFileSync(
      workflowPath,
      `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
const mainJob = createWorkflowJob({ name: "main-job", body: async () => "done" });
export default createWorkflow({ name: "workflow-a", mainJob });
`,
    );
    const context = await buildTriggerContext({ files: [workflowPath] });
    const source = `
import workflow, * as helpers from "./workflow";
console.log(helpers);
await workflow.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('import workflow, * as helpers from "./workflow"');
    expect(result).toContain("console.log(helpers)");
    expect(result).toContain('tailor.workflow.triggerWorkflow("workflow-a", undefined)');
  });

  test("does not transform an imported job shadowed by a parameter", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";
await step.trigger({ source: "outer" });
async function run(step: { trigger(): Promise<string> }) {
  return step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('execJobFunction("step-a", { source: "outer" })');
    expect(result).toContain("return step.trigger()");
  });

  test("does not transform an imported job shadowed by a local variable", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";
await step.trigger({ source: "outer" });
async function run() {
  const step = { trigger: async () => "local" };
  return step.trigger();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('execJobFunction("step-a", { source: "outer" })');
    expect(result).toContain("return step.trigger()");
  });

  test("does not transform a local object with a trigger method", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
const step = { trigger: async () => "local" };
await step.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("await step.trigger()");
    expect(result).not.toContain("tailor.workflow.execJobFunction");
  });

  test("escapes job and workflow names in generated calls", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();
    const currentModule = context.modules.get(normalizeFilePath(firstPath));
    const jobName = 'step"\\quoted';
    currentModule?.localBindings.set("step", { kind: "job", name: jobName });

    const result = transform(`${firstSource}\nawait step.trigger();\n`, firstPath, context);

    expect(result).toContain(`execJobFunction(${JSON.stringify(jobName)}, undefined)`);
  });
});
