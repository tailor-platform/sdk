import { describe, expect, test } from "vitest";
import {
  composeFunctionTreeshakeOptions,
  createUserTreeshakeOptions,
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

  describe("createUserTreeshakeOptions", () => {
    test("adds nothing when the user sets nothing", () => {
      expect(createUserTreeshakeOptions(undefined)).toEqual({});
      expect(createUserTreeshakeOptions({})).toEqual({});
    });

    test("ignores a switch that is explicitly undefined", () => {
      expect(
        createUserTreeshakeOptions({
          moduleSideEffects: undefined,
          annotations: undefined,
          unknownGlobalSideEffects: undefined,
          propertyReadSideEffects: undefined,
        }),
      ).toEqual({});
    });

    test("keeps the base default when a switch is explicitly undefined", () => {
      expect(
        composeFunctionTreeshakeOptions([
          createUserTreeshakeOptions({ moduleSideEffects: undefined }),
        ]),
      ).toMatchObject({ moduleSideEffects: false });
    });

    test("passes the boolean switches through", () => {
      expect(
        createUserTreeshakeOptions({
          moduleSideEffects: true,
          annotations: false,
          unknownGlobalSideEffects: true,
        }),
      ).toEqual({ moduleSideEffects: true, annotations: false, unknownGlobalSideEffects: true });
    });

    test("turns propertyReadSideEffects: false into the bundler's false", () => {
      expect(createUserTreeshakeOptions({ propertyReadSideEffects: false })).toEqual({
        propertyReadSideEffects: false,
      });
    });

    test('turns propertyReadSideEffects: true into the bundler\'s "always"', () => {
      expect(createUserTreeshakeOptions({ propertyReadSideEffects: true })).toEqual({
        propertyReadSideEffects: "always",
      });
    });

    test("overrides the base defaults when composed after them", () => {
      expect(
        composeFunctionTreeshakeOptions([createUserTreeshakeOptions({ moduleSideEffects: true })]),
      ).toMatchObject({ moduleSideEffects: true, annotations: true });
    });
  });
});
