import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { symlinkedTmpdir } from "./symlinked-tmpdir";
import { tempCwd } from "./temp-cwd";

describe("tempCwd", () => {
  test("switches into a directory it exposes by its real path when the temp directory is a symlink", () => {
    using tmpdir = symlinkedTmpdir();
    using tmp = tempCwd("sdk-temp-cwd-");

    expect(path.dirname(tmp.dir)).toBe(tmpdir.realDir);
    expect(process.cwd()).toBe(tmp.dir);
  });
});
