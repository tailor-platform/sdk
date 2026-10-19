import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { createWorkflowService } from "./service";

describe("createWorkflowService", () => {
  test("does not strip runtime start from an unbranded default export", async () => {
    using tmp = tempCwd("sdk-workflow-service-");
    const workflowFile = path.join(tmp.dir, "workflow.mjs");
    fs.writeFileSync(
      workflowFile,
      `
export const mainJob = {
  name: "main-job",
  start: () => {},
  body: () => {},
};

export default {
  name: "looks-like-workflow",
  mainJob,
  start: () => {},
};
`,
    );

    const service = createWorkflowService({
      config: { files: ["workflow.mjs"] },
      baseDir: tmp.dir,
    });

    await service.loadWorkflows();

    expect(service.workflows).toEqual({});
  });

  test.each([
    {
      case: "a default-exported workflow that fails validation",
      source: `
export const mainJob = brand({ name: "main-job", start: () => {}, body: () => {} }, "workflow-job");
export default brand({ name: 1, mainJob }, "workflow");
`,
      expected: {
        code: "DEFINITION_INVALID",
        message: expect.stringMatching(/^Invalid workflow in .*workflow\.mjs:\n {2}- name: /),
        context: { kind: "workflow", exportName: "default", issues: [{ path: ["name"] }] },
      },
    },
    {
      case: "a job that fails validation",
      source: `
export const otherJob = brand({ name: 1, start: () => {}, body: () => {} }, "workflow-job");
`,
      expected: {
        code: "DEFINITION_INVALID",
        message: expect.stringMatching(
          /^Invalid workflow job `otherJob` in .*workflow\.mjs:\n {2}- name: /,
        ),
        context: { kind: "workflow-job", exportName: "otherJob", issues: [{ path: ["name"] }] },
      },
    },
    {
      case: "a workflow under a named export",
      source: `
export const mainJob = brand({ name: "main-job", start: () => {}, body: () => {} }, "workflow-job");
export const order = brand({ name: "order", mainJob }, "workflow");
`,
      expected: {
        code: "DEFINITION_EXPORT_INVALID",
        message: expect.stringMatching(
          /^Workflow in .*workflow\.mjs must not be a named export, but it is exported as `order`\.$/,
        ),
        context: { kind: "workflow", exportName: "order" },
      },
    },
    {
      case: "a default-exported workflow also exported under a name",
      source: `
export const mainJob = brand({ name: "main-job", start: () => {}, body: () => {} }, "workflow-job");
const workflow = brand({ name: "order", mainJob }, "workflow");
export const alias = workflow;
export default workflow;
`,
      expected: {
        code: "DEFINITION_EXPORT_INVALID",
        message: expect.stringMatching(
          /^Workflow in .*workflow\.mjs must not be a named export, but it is exported as `alias`\.$/,
        ),
        context: { kind: "workflow", exportName: "alias" },
      },
    },
    {
      case: "a job as the default export",
      source: `
export default brand({ name: "main-job", start: () => {}, body: () => {} }, "workflow-job");
`,
      expected: {
        code: "DEFINITION_EXPORT_INVALID",
        message: expect.stringMatching(
          /^Workflow job in .*workflow\.mjs must not be the default export\.$/,
        ),
        context: { kind: "workflow-job", exportName: "default" },
      },
    },
  ])("reports $case", async ({ source, expected }) => {
    using tmp = tempCwd("sdk-workflow-service-");
    const workflowFile = path.join(tmp.dir, "workflow.mjs");
    fs.writeFileSync(
      workflowFile,
      `const brand = (value, kind) =>
  Object.defineProperty(value, Symbol.for("tailor-platform/sdk"), { value: kind });
${source}`,
    );

    const service = createWorkflowService({
      config: { files: ["workflow.mjs"] },
      baseDir: tmp.dir,
    });

    using _logger = silenceLogger("error");
    await expect(service.loadWorkflows()).rejects.toMatchObject({
      ...expected,
      context: { ...expected.context, file: workflowFile },
    });
  });
});
