import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { transformFunctionTriggers } from "#/cli/services/workflow/trigger-transformer";
import {
  buildTriggerContext,
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
    context.moduleResolution = {
      baseUrl: tempDir,
      paths: { "@workflows/*": ["*"] },
    };
    const source = `
import { step as importedStep } from "@workflows/first";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
  });

  test("prefers an exact tsconfig path over a wildcard match", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    context.moduleResolution = {
      baseUrl: tempDir,
      paths: {
        "jobs*/step": ["second"],
        "jobs/step": ["first"],
      },
    };
    const source = `
import { step as importedStep } from "jobs/step";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain('tailor.workflow.triggerJobFunction("step-b"');
  });

  test("prefers the tsconfig path wildcard with the longest prefix", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    context.moduleResolution = {
      baseUrl: tempDir,
      paths: {
        "jobs*/nested/step": ["second"],
        "jobs/nested*": ["first"],
      },
    };
    const source = `
import { step as importedStep } from "jobs/nested/step";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain('tailor.workflow.triggerJobFunction("step-b"');
  });

  test("resolves path aliases inherited from a base tsconfig", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "trigger-context-"));
    tempDirs.push(tempDir);
    const workflowsDir = path.join(tempDir, "workflows");
    mkdirSync(workflowsDir);
    writeFileSync(
      path.join(tempDir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@workflows/*": ["workflows/*"] },
        },
      }),
    );
    writeFileSync(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
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
import { step as importedStep } from "@workflows/job";
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

  test("resolves jobs through package imports", async () => {
    const { context, tempDir } = await createDuplicateExportContext();
    writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ type: "module", imports: { "#jobs": "./first.ts" } }),
    );
    const source = `
import { step as importedStep } from "#jobs";

await importedStep.trigger();
`;

    const result = transform(source, path.join(tempDir, "caller.ts"), context);

    expect(result).toContain('tailor.workflow.triggerJobFunction("step-a", undefined)');
    expect(result).not.toContain("importedStep.trigger()");
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
