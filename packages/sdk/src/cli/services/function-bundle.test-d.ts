import { assertType, describe, test } from "vitest";
import type { BuildFunctionBundleOptions } from "./function-bundle";

describe("BuildFunctionBundleOptions", () => {
  const options = {
    kind: "executor",
    name: "fn",
    sourceFile: "fn.ts",
    tsconfig: undefined,
    entry: () => "",
  } as const;

  test("accepts turning the runtime-global check off", () => {
    assertType<BuildFunctionBundleOptions>({ ...options, runtimeGlobals: false });
  });

  test("rejects omitting runtimeGlobals", () => {
    // @ts-expect-error every caller chooses whether to check runtime globals
    assertType<BuildFunctionBundleOptions>(options);
  });
});
