import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { rolldown } from "rolldown";
import { aroundEach, describe, expect, test } from "vitest";
import {
  createLogLevelTreeshakeOptions,
  manualPureFunctionsForLogLevel,
  normalizeBundleLogLevel,
  resolveBundleLogLevel,
} from "./bundle-log-level";

const loggerSourcePath = fileURLToPath(new URL("../../runtime/logger.ts", import.meta.url));

describe("bundle-log-level", () => {
  test("defaults to DEBUG", () => {
    expect(resolveBundleLogLevel()).toBe("DEBUG");
  });

  test("normalizes supported values", () => {
    expect(resolveBundleLogLevel("warn")).toBe("WARN");
    expect(resolveBundleLogLevel(" error ")).toBe("ERROR");
    expect(normalizeBundleLogLevel("silent")).toBe("SILENT");
  });

  test("rejects unsupported values", () => {
    expect(() => resolveBundleLogLevel("OFF")).toThrow(
      /Expected one of: DEBUG, INFO, WARN, ERROR, SILENT/,
    );
  });

  test("treats console.log as DEBUG level, dropping it at INFO", () => {
    expect(manualPureFunctionsForLogLevel("INFO")).toContain("console.log");
    expect(manualPureFunctionsForLogLevel("INFO")).not.toContain("console.info");
    expect(manualPureFunctionsForLogLevel("DEBUG")).not.toContain("console.log");
  });

  test("maps WARN to console calls below warn", () => {
    expect(manualPureFunctionsForLogLevel("WARN")).toEqual(
      expect.arrayContaining(["console.debug", "console.log", "console.info", "console.trace"]),
    );
    expect(manualPureFunctionsForLogLevel("WARN")).not.toContain("console.warn");
    expect(manualPureFunctionsForLogLevel("WARN")).not.toContain("console.error");
  });

  test("maps SILENT to all levelled console calls", () => {
    expect(manualPureFunctionsForLogLevel("SILENT")).toEqual(
      expect.arrayContaining(["console.debug", "console.log", "console.warn", "console.error"]),
    );
  });

  test("never drops console.assert, which is outside the platform severity system", () => {
    for (const level of ["DEBUG", "INFO", "WARN", "ERROR", "SILENT"] as const) {
      expect(manualPureFunctionsForLogLevel(level)).not.toContain("console.assert");
    }
  });

  test("drops globalThis.tailor.logger.debug at INFO and above", () => {
    expect(manualPureFunctionsForLogLevel("DEBUG")).not.toContain("globalThis.tailor.logger.debug");
    expect(manualPureFunctionsForLogLevel("INFO")).toContain("globalThis.tailor.logger.debug");
    expect(manualPureFunctionsForLogLevel("INFO")).not.toContain("globalThis.tailor.logger.info");
  });

  test("maps WARN to globalThis.tailor.logger calls below warn", () => {
    expect(manualPureFunctionsForLogLevel("WARN")).toEqual(
      expect.arrayContaining(["globalThis.tailor.logger.debug", "globalThis.tailor.logger.info"]),
    );
    expect(manualPureFunctionsForLogLevel("WARN")).not.toContain("globalThis.tailor.logger.warn");
    expect(manualPureFunctionsForLogLevel("WARN")).not.toContain("globalThis.tailor.logger.error");
  });

  test("maps SILENT to all levelled globalThis.tailor.logger calls", () => {
    expect(manualPureFunctionsForLogLevel("SILENT")).toEqual(
      expect.arrayContaining([
        "globalThis.tailor.logger.debug",
        "globalThis.tailor.logger.info",
        "globalThis.tailor.logger.warn",
        "globalThis.tailor.logger.error",
      ]),
    );
  });

  test("omits manual pure functions for DEBUG", () => {
    expect(createLogLevelTreeshakeOptions("DEBUG")).not.toHaveProperty("manualPureFunctions");
  });
});

describe("bundle-log-level applied to the real runtime/logger.ts via rolldown", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function bundleHandler(logLevel: Parameters<typeof createLogLevelTreeshakeOptions>[0]) {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "log-level-treeshake-")));
    const entry = path.join(tmpDir, "entry.ts");
    fs.writeFileSync(
      entry,
      `
import { debug, info, warn, error, setAttributes } from ${JSON.stringify(loggerSourcePath)};

export function handler() {
  setAttributes({ requestId: "r-1" });
  debug("debug message");
  info("info message");
  warn("warn message");
  error("error message");
  return 42;
}
`,
    );

    const bundle = await rolldown({
      input: entry,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
        ...createLogLevelTreeshakeOptions(logLevel),
      },
    });
    const { output } = await bundle.generate({ format: "esm" });
    return output[0].code;
  }

  test("keeps every severity at DEBUG", async () => {
    const code = await bundleHandler("DEBUG");
    expect(code).toContain("globalThis.tailor.logger.debug");
    expect(code).toContain("globalThis.tailor.logger.info");
    expect(code).toContain("globalThis.tailor.logger.warn");
    expect(code).toContain("globalThis.tailor.logger.error");
  });

  test("drops only debug at INFO", async () => {
    const code = await bundleHandler("INFO");
    expect(code).not.toContain("globalThis.tailor.logger.debug");
    expect(code).toContain("globalThis.tailor.logger.info");
    expect(code).toContain("globalThis.tailor.logger.warn");
    expect(code).toContain("globalThis.tailor.logger.error");
  });

  test("drops debug and info at WARN", async () => {
    const code = await bundleHandler("WARN");
    expect(code).not.toContain("globalThis.tailor.logger.debug");
    expect(code).not.toContain("globalThis.tailor.logger.info");
    expect(code).toContain("globalThis.tailor.logger.warn");
    expect(code).toContain("globalThis.tailor.logger.error");
  });

  test("drops debug, info, and warn at ERROR", async () => {
    const code = await bundleHandler("ERROR");
    expect(code).not.toContain("globalThis.tailor.logger.debug");
    expect(code).not.toContain("globalThis.tailor.logger.info");
    expect(code).not.toContain("globalThis.tailor.logger.warn");
    expect(code).toContain("globalThis.tailor.logger.error");
  });

  test("drops every severity at SILENT but keeps setAttributes", async () => {
    const code = await bundleHandler("SILENT");
    expect(code).not.toContain("globalThis.tailor.logger.debug");
    expect(code).not.toContain("globalThis.tailor.logger.info");
    expect(code).not.toContain("globalThis.tailor.logger.warn");
    expect(code).not.toContain("globalThis.tailor.logger.error");
    expect(code).toContain("globalThis.tailor.logger.setAttributes");
  });
});
