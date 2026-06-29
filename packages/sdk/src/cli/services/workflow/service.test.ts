import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { createWorkflowService } from "./service";

describe("createWorkflowService", () => {
  test("does not strip runtime trigger from an unbranded default export", async () => {
    using tmp = tempCwd("sdk-workflow-service-");
    const workflowFile = path.join(tmp.dir, "workflow.mjs");
    fs.writeFileSync(
      workflowFile,
      `
export const mainJob = {
  name: "main-job",
  trigger: () => {},
  body: () => {},
};

export default {
  name: "looks-like-workflow",
  mainJob,
  trigger: () => {},
};
`,
    );

    const service = createWorkflowService({ config: { files: ["workflow.mjs"] } });

    await service.loadWorkflows();

    expect(service.workflows).toEqual({});
  });
});
