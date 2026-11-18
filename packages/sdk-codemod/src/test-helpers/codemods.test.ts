import { describe, expect, test } from "vitest";
import { reviewThroughRunner } from "./codemods";

describe("reviewThroughRunner", () => {
  test.each([
    ["an unregistered codemod", "v0/missing", "x.ts", "is not registered with a script"],
    ["a codemod without a prompt", "v2/wait-point-rename", "x.ts", "has no prompt"],
    [
      "a path outside the codemod's file patterns",
      "v3/files-ignores-to-negation",
      "notes.md",
      "does not run on notes.md",
    ],
    [
      "a path under a directory the runner skips",
      "v3/files-ignores-to-negation",
      "dist/tailor.config.ts",
      "does not run on dist/tailor.config.ts",
    ],
  ])("rejects %s, which the runner never reviews", async (_name, id, relativePath, message) => {
    await expect(reviewThroughRunner(id, "", relativePath)).rejects.toThrow(message);
  });
});
