import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import {
  CONFIG_SOURCE_DIR,
  captureCallerDir,
  getConfigSourceDir,
  resolveConfigBaseDir,
} from "./caller-dir";

function callCaptureCallerDir(): string | undefined {
  return captureCallerDir(callCaptureCallerDir);
}

describe("captureCallerDir", () => {
  test("returns the directory of the immediate caller", () => {
    const dir = callCaptureCallerDir();
    expect(dir).toBe(path.dirname(fileURLToPath(import.meta.url)));
  });
});

describe("getConfigSourceDir", () => {
  test("round-trips a value stashed under CONFIG_SOURCE_DIR", () => {
    const config: Record<PropertyKey, unknown> = {};
    config[CONFIG_SOURCE_DIR] = "/some/dir";
    expect(getConfigSourceDir(config)).toBe("/some/dir");
  });

  test("returns undefined when nothing was stashed", () => {
    expect(getConfigSourceDir({})).toBeUndefined();
  });
});

describe("resolveConfigBaseDir", () => {
  test("prefers the captured source dir over the config file's directory", () => {
    const config: Record<PropertyKey, unknown> = { path: "/config/dir/tailor.config.ts" };
    config[CONFIG_SOURCE_DIR] = "/captured/dir";
    expect(resolveConfigBaseDir(config as { path: string })).toBe("/captured/dir");
  });

  test("falls back to the config file's directory when nothing was captured", () => {
    const config = { path: "/config/dir/tailor.config.ts" };
    expect(resolveConfigBaseDir(config)).toBe("/config/dir");
  });
});
