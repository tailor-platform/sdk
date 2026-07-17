import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { transformStartCalls } from "#/cli/services/workflow/start-transformer";
import {
  buildStartContext,
  normalizeFilePath,
  serializeStartContext,
  type StartContext,
  type StartModuleBindings,
} from "./start-context";

describe("serializeStartContext", () => {
  function emptyContext(): StartContext {
    return { modules: new Map() };
  }

  function bindings(localBindings: StartModuleBindings["localBindings"]) {
    return { localBindings, exports: new Map(localBindings) };
  }

  test("returns empty string for undefined", () => {
    expect(serializeStartContext(undefined)).toBe("");
  });

  test("returns deterministic output for empty maps", () => {
    expect(serializeStartContext(emptyContext())).toBe("[]");
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

    expect(serializeStartContext(first)).toBe(serializeStartContext(second));
  });

  test("returns different output when map content differs", () => {
    const first = emptyContext();
    first.modules.set("/jobs", bindings(new Map([["job", { kind: "job", name: "ProcessOrder" }]])));
    const second = emptyContext();
    second.modules.set(
      "/jobs",
      bindings(new Map([["job", { kind: "job", name: "ProcessPayment" }]])),
    );

    expect(serializeStartContext(first)).not.toBe(serializeStartContext(second));
  });

  test("distinguishes entries in different maps", () => {
    const first = emptyContext();
    first.modules.set(
      "/module",
      bindings(new Map([["target", { kind: "workflow", name: "Name" }]])),
    );
    const second = emptyContext();
    second.modules.set("/module", bindings(new Map([["target", { kind: "job", name: "Name" }]])));

    expect(serializeStartContext(first)).not.toBe(serializeStartContext(second));
  });
});

describe("buildStartContext", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function createDuplicateExportContext() {
    const tempDir = mkdtempSync(path.join(tmpdir(), "start-context-"));
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
    const context = await buildStartContext({ files: [firstPath, secondPath] });
    return { context, firstPath, firstSource, tempDir };
  }

  function transform(source: string, currentFilePath: string, context: StartContext) {
    return transformStartCalls(source, context, currentFilePath);
  }

  test("resolves duplicate local export names from the current module", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();

    const result = transform(`${firstSource}\nawait step.start();\n`, firstPath, context);

    expect(result).toContain('tailor.workflow.startJobFunction("step-a", undefined)');
    expect(result).not.toContain('tailor.workflow.startJobFunction("step-b"');
  });

  test("resolves aliased named imports", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step as importedStep } from "./first";
await importedStep.start();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.startJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.start()");
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
    const context = await buildStartContext({ files: [workflowPath] });
    const source = `
import workflow from "./workflow";
await workflow.start();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('import workflow from "./workflow"');
    expect(result).toContain('tailor.workflow.startWorkflow("workflow-a", undefined)');
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
    const context = await buildStartContext({ files: [workflowPath] });
    const source = `
import workflow, * as helpers from "./workflow";
console.log(helpers);
await workflow.start();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('import workflow, * as helpers from "./workflow"');
    expect(result).toContain("console.log(helpers)");
    expect(result).toContain('tailor.workflow.startWorkflow("workflow-a", undefined)');
  });

  test("does not transform an imported job shadowed by a parameter", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";
await step.start({ source: "outer" });
async function run(step: { start(): Promise<string> }) {
  return step.start();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('startJobFunction("step-a", { source: "outer" })');
    expect(result).toContain("return step.start()");
  });

  test("does not transform an imported job shadowed by a local variable", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
import { step } from "./first";
await step.start({ source: "outer" });
async function run() {
  const step = { start: async () => "local" };
  return step.start();
}
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('startJobFunction("step-a", { source: "outer" })');
    expect(result).toContain("return step.start()");
  });

  test("does not transform a local object with a start method", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    const source = `
const step = { start: async () => "local" };
await step.start();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain("await step.start()");
    expect(result).not.toContain("tailor.workflow.startJobFunction");
  });

  test("escapes job and workflow names in generated calls", async () => {
    const { context, firstPath, firstSource } = await createDuplicateExportContext();
    const currentModule = context.modules.get(normalizeFilePath(firstPath));
    const jobName = 'step"\\quoted';
    currentModule?.localBindings.set("step", { kind: "job", name: jobName });

    const result = transform(`${firstSource}\nawait step.start();\n`, firstPath, context);

    expect(result).toContain(`startJobFunction(${JSON.stringify(jobName)}, undefined)`);
  });
});
