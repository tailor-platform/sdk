import { describe, expect, test } from "vitest";
import {
  composeFunctionTreeshakeOptions,
  mergeFunctionTreeshakeOptions,
} from "./function-treeshake";

describe("function-treeshake", () => {
  test("composes base function treeshake options", () => {
    expect(composeFunctionTreeshakeOptions()).toEqual({
      moduleSideEffects: false,
      annotations: true,
      unknownGlobalSideEffects: false,
    });
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

  test("composes base options with extension fragments", () => {
    expect(composeFunctionTreeshakeOptions([{ manualPureFunctions: ["console.log"] }])).toEqual({
      moduleSideEffects: false,
      annotations: true,
      unknownGlobalSideEffects: false,
      manualPureFunctions: ["console.log"],
    });
  });
});
