import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleExecutors } from "./bundler";

describe("bundleExecutors", () => {
  test("does not throw when no executor files match", async () => {
    using tmp = tempCwd("sdk-bundler-");
    fs.mkdirSync(path.join(tmp.dir, "src/backend/provisioning/executor"), {
      recursive: true,
    });

    await expect(
      bundleExecutors({
        config: {
          files: ["./src/backend/provisioning/executor/*.ts"],
        },
        baseDir: tmp.dir,
      }),
    ).resolves.toEqual(new Map());
  });

  test("rejects an executor that references process.env", async () => {
    using tmp = tempCwd("sdk-bundler-executor-forbidden-global-");
    const executorDir = path.join(tmp.dir, "src/backend/nodeglobal/executor");
    fs.mkdirSync(executorDir, { recursive: true });
    fs.writeFileSync(
      path.join(executorDir, "leaky.ts"),
      `export default {\n` +
        `  name: "leaky",\n` +
        `  trigger: { kind: "schedule", cron: "0 12 * * *" },\n` +
        `  operation: {\n` +
        `    kind: "function",\n` +
        `    body: async () => {\n` +
        `      if (process.env.SOME_FLAG === "1") return;\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );

    await expect(
      bundleExecutors({
        config: { files: ["./src/backend/nodeglobal/executor/*.ts"] },
        baseDir: tmp.dir,
      }),
    ).rejects.toThrow(/references a global unavailable in the Tailor Platform runtime: process/);
  });

  test("bundles an executor that uses Web Standard globals", async () => {
    using tmp = tempCwd("sdk-bundler-executor-web-standard-");
    const executorDir = path.join(tmp.dir, "src/backend/webstandard/executor");
    fs.mkdirSync(executorDir, { recursive: true });
    fs.writeFileSync(
      path.join(executorDir, "fetcher.ts"),
      `export default {\n` +
        `  name: "fetcher",\n` +
        `  trigger: { kind: "schedule", cron: "0 12 * * *" },\n` +
        `  operation: {\n` +
        `    kind: "function",\n` +
        `    body: async () => {\n` +
        `      await fetch(new URL("https://example.com"));\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );

    const result = await bundleExecutors({
      config: { files: ["./src/backend/webstandard/executor/*.ts"] },
      baseDir: tmp.dir,
    });

    expect(result.get("fetcher")).toBeDefined();
  });
});
