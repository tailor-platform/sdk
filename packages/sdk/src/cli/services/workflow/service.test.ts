import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
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
});
