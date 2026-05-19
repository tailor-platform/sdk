import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSecretDir, writeSecretFile } from "./secret-file";

const isWindows = process.platform === "win32";

describe("writeSecretFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-secret-file-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes content to the target path", () => {
    const target = path.join(tempDir, "nested", "config.yaml");
    writeSecretFile(target, "token: abc");
    expect(fs.readFileSync(target, "utf-8")).toBe("token: abc");
  });

  it.skipIf(isWindows)("creates the parent directory with mode 0700", () => {
    const target = path.join(tempDir, "child", "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(path.dirname(target)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it.skipIf(isWindows)("creates the file with mode 0600", () => {
    const target = path.join(tempDir, "config.yaml");
    writeSecretFile(target, "token: abc");
    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.skipIf(isWindows)("tightens permissions on existing world-readable files", () => {
    const target = path.join(tempDir, "config.yaml");
    fs.writeFileSync(target, "old", { mode: 0o644 });
    fs.chmodSync(target, 0o644);

    writeSecretFile(target, "new");

    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });

  it.skipIf(isWindows)("tightens permissions on existing world-readable directories", () => {
    const dir = path.join(tempDir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    writeSecretFile(path.join(dir, "config.yaml"), "x");

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});

describe("ensureSecretDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-secret-dir-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.skipIf(isWindows)("creates a new directory with mode 0700", () => {
    const dir = path.join(tempDir, "fresh");
    ensureSecretDir(dir);
    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it.skipIf(isWindows)("tightens permissions on existing directories", () => {
    const dir = path.join(tempDir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);

    ensureSecretDir(dir);

    const mode = fs.statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("is idempotent when the directory already has the correct mode", () => {
    const dir = path.join(tempDir, "ok");
    ensureSecretDir(dir);
    expect(() => ensureSecretDir(dir)).not.toThrow();
  });
});
