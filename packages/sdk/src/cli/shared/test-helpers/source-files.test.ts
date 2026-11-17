import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { listSourceFiles } from "./source-files";
import { tempDir } from "./temp-dir";

describe("listSourceFiles", () => {
  test("lists non-test sources and skips the dot and __test_ trees other suites create", () => {
    using tmp = tempDir("sdk-source-files-");
    const files = [
      "src.ts",
      "nested/b.ts",
      "x.test.ts",
      "readme.md",
      ".sdk-content-mapper-x/c.ts",
      "__test_fixtures__/d.ts",
    ];
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(tmp.dir, file)), { recursive: true });
      fs.writeFileSync(path.join(tmp.dir, file), "");
    }

    const listed = listSourceFiles(tmp.dir).map((file) => path.relative(tmp.dir, file));

    expect(listed.toSorted()).toEqual(["nested/b.ts", "src.ts"]);
  });
});
