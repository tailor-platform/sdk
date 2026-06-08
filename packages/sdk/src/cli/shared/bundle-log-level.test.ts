import { describe, expect, test } from "vitest";
import {
  createLogLevelTreeshakeOptions,
  manualPureFunctionsForLogLevel,
  normalizeBundleLogLevel,
  resolveBundleLogLevel,
} from "./bundle-log-level";

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

  test("omits manual pure functions for DEBUG", () => {
    expect(createLogLevelTreeshakeOptions("DEBUG")).not.toHaveProperty("manualPureFunctions");
  });
});
