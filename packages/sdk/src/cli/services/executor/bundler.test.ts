import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, it } from "vitest";
import { tempCwd } from "@/cli/shared/test-helpers/temp-cwd";
import { bundleExecutors } from "./bundler";

describe("bundleExecutors", () => {
  it("does not throw when no executor files match", async () => {
    using tmp = tempCwd("sdk-bundler-");
    fs.mkdirSync(path.join(tmp.dir, "src/backend/provisioning/executor"), {
      recursive: true,
    });

    await expect(
      bundleExecutors({
        config: {
          files: ["./src/backend/provisioning/executor/*.ts"],
        },
      }),
    ).resolves.toEqual(new Map());
  });
});
