import { describe, expect, test } from "vitest";
import {
  createFunctionTreeshakeOptions,
  manualPureFunctionsForLogLevel,
  mergeFunctionTreeshakeOptions,
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

  test("omits manual pure functions for DEBUG", () => {
    expect(createFunctionTreeshakeOptions("DEBUG")).not.toHaveProperty("manualPureFunctions");
  });

  test("merges treeshake fragments and de-duplicates manual pure functions", () => {
    expect(
      mergeFunctionTreeshakeOptions([
        { moduleSideEffects: false, manualPureFunctions: ["console.log"] },
        { annotations: true, manualPureFunctions: ["console.log", "debug.trace"] },
      ]),
    ).toEqual({
      moduleSideEffects: false,
      annotations: true,
      manualPureFunctions: ["console.log", "debug.trace"],
    });
  });
});
