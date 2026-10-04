import { describe, expect, test } from "vitest";
import { buildOptionsOf } from "./build-options";

describe("buildOptionsOf", () => {
  test("reads the options from buildOptions", () => {
    expect(
      buildOptionsOf({
        buildOptions: {
          inlineSourcemap: false,
          logLevel: "WARN",
          allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] },
        },
      }),
    ).toEqual({
      inlineSourcemap: false,
      logLevel: "WARN",
      allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] },
    });
  });

  test("falls back to the deprecated top-level inlineSourcemap and logLevel", () => {
    // oxlint-disable-next-line typescript/no-deprecated -- The fallback for the deprecated fields is what this test covers.
    expect(buildOptionsOf({ inlineSourcemap: false, logLevel: "ERROR" })).toEqual({
      inlineSourcemap: false,
      logLevel: "ERROR",
      allowedRuntimeGlobals: undefined,
    });
  });

  test("leaves every option unset when neither place sets it", () => {
    expect(buildOptionsOf({})).toEqual({
      inlineSourcemap: undefined,
      logLevel: undefined,
      allowedRuntimeGlobals: undefined,
    });
  });
});
