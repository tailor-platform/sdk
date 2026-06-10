import { describe, expect, test } from "vitest";
import { platformBundleDefinePlugin } from "./platform-bundle-plugin";

const run = (code: string): string | null => {
  const transform = platformBundleDefinePlugin.transform as (
    code: string,
  ) => { code: string } | null;
  return transform(code)?.code ?? null;
};

describe("platformBundleDefinePlugin", () => {
  test("folds the gate member-expression to true", () => {
    expect(run("if (!process.env.TAILOR_PLATFORM_BUNDLE) register();")).toBe(
      "if (!true) register();",
    );
  });

  test("skips source without the token", () => {
    expect(run("export const x = 1;")).toBeNull();
  });

  test("does not rewrite a longer key or a different owner", () => {
    const longerKey = "read(process.env.TAILOR_PLATFORM_BUNDLE_MODE);";
    expect(run(longerKey)).toBe(longerKey);
    const otherOwner = "read(self.process.env.TAILOR_PLATFORM_BUNDLE);";
    expect(run(otherOwner)).toBe(otherOwner);
  });
});
