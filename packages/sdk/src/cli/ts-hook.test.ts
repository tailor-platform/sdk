import { describe, expect, test, vi } from "vitest";
import { load, loadSync } from "./ts-hook.mjs";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("const x: number = 1;"),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("const x: number = 1;"),
}));

vi.mock("amaro", () => ({
  transformSync: vi.fn().mockReturnValue({ code: "const x = 1;" }),
}));

describe("load", () => {
  test("strips query string before fileURLToPath to avoid ERR_INVALID_FILE_URL_PATH", async () => {
    const nextLoad = vi.fn();
    const result = await load("file:///path/to/foo.ts?tailorImportNonce=1", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("strips hash before fileURLToPath", async () => {
    const nextLoad = vi.fn();
    const result = await load("file:///path/to/foo.mts#anchor", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("delegates non-file: URLs to nextLoad", async () => {
    const nextLoad = vi.fn();
    await load("node:path", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("node:path", {});
  });

  test("delegates non-TS file URLs to nextLoad", async () => {
    const nextLoad = vi.fn();
    await load("file:///path/to/foo.js", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.js", {});
  });
});

describe("loadSync", () => {
  test("strips query string before fileURLToPath to avoid ERR_INVALID_FILE_URL_PATH", () => {
    const nextLoad = vi.fn();
    const result = loadSync("file:///path/to/foo.ts?tailorImportNonce=1", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("delegates non-file: URLs to nextLoad", () => {
    const nextLoad = vi.fn();
    loadSync("node:path", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("node:path", {});
  });

  test("delegates non-TS file URLs to nextLoad", () => {
    const nextLoad = vi.fn();
    loadSync("file:///path/to/foo.js", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.js", {});
  });
});
