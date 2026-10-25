import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { symlinkedTmpdir } from "./symlinked-tmpdir";
import { makeTempDir, tempDir } from "./temp-dir";

describe("makeTempDir", () => {
  test("returns the real path of a new directory when the temp directory is a symlink", () => {
    using tmpdir = symlinkedTmpdir();

    const dir = makeTempDir("sdk-make-temp-dir-");

    expect(path.dirname(dir)).toBe(tmpdir.realDir);
  });
});

describe("tempDir", () => {
  test("exposes a directory by its real path without switching into it", () => {
    using tmpdir = symlinkedTmpdir();
    const cwd = process.cwd();
    using tmp = tempDir("sdk-temp-dir-");

    expect(path.dirname(tmp.dir)).toBe(tmpdir.realDir);
    expect(process.cwd()).toBe(cwd);
  });
});
