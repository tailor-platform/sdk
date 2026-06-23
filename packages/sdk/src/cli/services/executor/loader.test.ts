import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "@/cli/shared/test-helpers/temp-cwd";
import { loadExecutor } from "./loader";

describe("loadExecutor", () => {
  test("accepts executor trigger helper args", async () => {
    using tmp = tempCwd("sdk-executor-loader-");
    const executorFile = path.join(tmp.dir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "function",
    body: async () => {},
  },
});
`,
    );

    const executor = await loadExecutor(executorFile);

    expect(executor).not.toBeNull();
    expect(executor?.trigger).not.toHaveProperty("__args");
  });
});
