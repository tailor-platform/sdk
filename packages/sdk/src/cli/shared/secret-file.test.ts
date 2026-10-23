import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { ensureSecretDir, tightenSecretFilePermissions, writeSecretFile } from "./secret-file";
import { tempCwd } from "./test-helpers/temp-cwd";

const isWindows = process.platform === "win32";

describe("writeSecretFile", () => {
  test("writes content to the target path", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const target = path.join(tempDir.dir, "nested", "config.yaml");
    writeSecretFile(target, "token: abc");
    expect(fs.readFileSync(target, "utf-8")).toBe("token: abc");
  });

  test.skipIf(isWindows)("creates the parent directory with mode 0700", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const target = path.join(tempDir.dir, "child", "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(path.dirname(target)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test.skipIf(isWindows)("creates the file with mode 0600", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const target = path.join(tempDir.dir, "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test.skipIf(isWindows)("tightens permissions on existing world-readable files", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const target = path.join(tempDir.dir, "config.yaml");
    fs.writeFileSync(target, "old", { mode: 0o644 });
    fs.chmodSync(target, 0o644);

    writeSecretFile(target, "new");

    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });

  test.skipIf(isWindows)("replaces an existing file instead of rewriting it in place", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const target = path.join(tempDir.dir, "config.yaml");
    writeSecretFile(target, "old");
    const before = fs.statSync(target).ino;

    writeSecretFile(target, "new");

    expect(fs.statSync(target).ino).not.toBe(before);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
    expect(fs.readdirSync(tempDir.dir)).toEqual(["config.yaml"]);
  });

  test.skipIf(isWindows)("writes through a symlinked file and keeps the link", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const realTarget = path.join(tempDir.dir, "dotfiles", "config.yaml");
    fs.mkdirSync(path.dirname(realTarget));
    fs.writeFileSync(realTarget, "old");
    const link = path.join(tempDir.dir, "config.yaml");
    fs.symlinkSync(realTarget, link);

    writeSecretFile(link, "new");

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(realTarget, "utf-8")).toBe("new");
    expect(fs.statSync(realTarget).mode & 0o777).toBe(0o600);
  });

  test.skipIf(isWindows)("creates the file a dangling symlink points to", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const realTarget = path.join(tempDir.dir, "dotfiles", "config.yaml");
    fs.mkdirSync(path.dirname(realTarget));
    const link = path.join(tempDir.dir, "config.yaml");
    fs.symlinkSync(realTarget, link);

    writeSecretFile(link, "new");

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(realTarget, "utf-8")).toBe("new");
  });

  test.skipIf(isWindows)("follows a chain of symlinks whose last target is missing", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const realTarget = path.join(tempDir.dir, "dotfiles", "config.yaml");
    fs.mkdirSync(path.dirname(realTarget));
    const middle = path.join(tempDir.dir, "middle.yaml");
    fs.symlinkSync(realTarget, middle);
    const link = path.join(tempDir.dir, "config.yaml");
    fs.symlinkSync("middle.yaml", link);

    writeSecretFile(link, "new");

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(middle).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(realTarget, "utf-8")).toBe("new");
  });

  test.skipIf(isWindows)("tightens permissions on existing world-readable directories", () => {
    using tempDir = tempCwd("tailor-secret-file-");
    const dir = path.join(tempDir.dir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    writeSecretFile(path.join(dir, "config.yaml"), "x");

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});

describe("ensureSecretDir", () => {
  test.skipIf(isWindows)("creates a new directory with mode 0700", () => {
    using tempDir = tempCwd("tailor-secret-dir-");
    const dir = path.join(tempDir.dir, "fresh");
    ensureSecretDir(dir);
    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test.skipIf(isWindows)("tightens permissions on existing directories", () => {
    using tempDir = tempCwd("tailor-secret-dir-");
    const dir = path.join(tempDir.dir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    ensureSecretDir(dir);

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("is idempotent when the directory already has the correct mode", () => {
    using tempDir = tempCwd("tailor-secret-dir-");
    const dir = path.join(tempDir.dir, "ok");
    ensureSecretDir(dir);
    expect(() => ensureSecretDir(dir)).not.toThrow();
  });
});

describe("tightenSecretFilePermissions", () => {
  test.skipIf(isWindows)("tightens a world-readable file to 0600", () => {
    using tempDir = tempCwd("tailor-tighten-");
    const target = path.join(tempDir.dir, "config.yaml");
    fs.writeFileSync(target, "x", { mode: 0o644 });
    fs.chmodSync(target, 0o644);

    tightenSecretFilePermissions(target);

    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  test.skipIf(isWindows)("tightens the parent directory to 0700", () => {
    using tempDir = tempCwd("tailor-tighten-");
    const dir = path.join(tempDir.dir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    const target = path.join(dir, "config.yaml");
    fs.writeFileSync(target, "x");

    tightenSecretFilePermissions(target);

    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("does not throw when the file is missing", () => {
    using tempDir = tempCwd("tailor-tighten-");
    expect(() =>
      tightenSecretFilePermissions(path.join(tempDir.dir, "does-not-exist.yaml")),
    ).not.toThrow();
  });

  test.skipIf(isWindows)("is a no-op when the modes already match", () => {
    using tempDir = tempCwd("tailor-tighten-");
    const target = path.join(tempDir.dir, "ok", "config.yaml");
    fs.mkdirSync(path.dirname(target), { mode: 0o700 });
    fs.writeFileSync(target, "x", { mode: 0o600 });
    fs.chmodSync(target, 0o600);

    expect(() => tightenSecretFilePermissions(target)).not.toThrow();
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});
