import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ensureSecretDir, tightenSecretFilePermissions, writeSecretFile } from "./secret-file";

const isWindows = process.platform === "win32";

function useTempDir(prefix: string): { current: string } {
  const holder = { current: "" };
  beforeEach(() => {
    holder.current = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  });
  afterEach(() => {
    fs.rmSync(holder.current, { recursive: true, force: true });
  });
  return holder;
}

describe("writeSecretFile", () => {
  const tempDir = useTempDir("tailor-secret-file-");

  test("writes content to the target path", () => {
    const target = path.join(tempDir.current, "nested", "config.yaml");
    writeSecretFile(target, "token: abc");
    expect(fs.readFileSync(target, "utf-8")).toBe("token: abc");
  });

  test.skipIf(isWindows)("creates the parent directory with mode 0700", () => {
    const target = path.join(tempDir.current, "child", "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(path.dirname(target)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test.skipIf(isWindows)("creates the file with mode 0600", () => {
    const target = path.join(tempDir.current, "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test.skipIf(isWindows)("tightens permissions on existing world-readable files", () => {
    const target = path.join(tempDir.current, "config.yaml");
    fs.writeFileSync(target, "old", { mode: 0o644 });
    fs.chmodSync(target, 0o644);

    writeSecretFile(target, "new");

    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });

  test.skipIf(isWindows)("tightens permissions on existing world-readable directories", () => {
    const dir = path.join(tempDir.current, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    writeSecretFile(path.join(dir, "config.yaml"), "x");

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});

describe("ensureSecretDir", () => {
  const tempDir = useTempDir("tailor-secret-dir-");

  test.skipIf(isWindows)("creates a new directory with mode 0700", () => {
    const dir = path.join(tempDir.current, "fresh");
    ensureSecretDir(dir);
    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test.skipIf(isWindows)("tightens permissions on existing directories", () => {
    const dir = path.join(tempDir.current, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    ensureSecretDir(dir);

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("is idempotent when the directory already has the correct mode", () => {
    const dir = path.join(tempDir.current, "ok");
    ensureSecretDir(dir);
    expect(() => ensureSecretDir(dir)).not.toThrow();
  });
});

describe("tightenSecretFilePermissions", () => {
  const tempDir = useTempDir("tailor-tighten-");

  test.skipIf(isWindows)("tightens a world-readable file to 0600", () => {
    const target = path.join(tempDir.current, "config.yaml");
    fs.writeFileSync(target, "x", { mode: 0o644 });
    fs.chmodSync(target, 0o644);

    tightenSecretFilePermissions(target);

    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  test.skipIf(isWindows)("tightens the parent directory to 0700", () => {
    const dir = path.join(tempDir.current, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    const target = path.join(dir, "config.yaml");
    fs.writeFileSync(target, "x");

    tightenSecretFilePermissions(target);

    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("does not throw when the file is missing", () => {
    expect(() =>
      tightenSecretFilePermissions(path.join(tempDir.current, "does-not-exist.yaml")),
    ).not.toThrow();
  });

  test.skipIf(isWindows)("is a no-op when the modes already match", () => {
    const target = path.join(tempDir.current, "ok", "config.yaml");
    fs.mkdirSync(path.dirname(target), { mode: 0o700 });
    fs.writeFileSync(target, "x", { mode: 0o600 });
    fs.chmodSync(target, 0o600);

    expect(() => tightenSecretFilePermissions(target)).not.toThrow();
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});
