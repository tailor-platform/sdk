import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { symlinkedTmpdir } from "./symlinked-tmpdir";
import { makeTempDir } from "./temp-dir";

describe("makeTempDir", () => {
  test("returns the real path of a new directory when the temp directory is a symlink", () => {
    using tmpdir = symlinkedTmpdir();

    const dir = makeTempDir("sdk-make-temp-dir-");

    expect(path.dirname(dir)).toBe(tmpdir.realDir);
  });
});
