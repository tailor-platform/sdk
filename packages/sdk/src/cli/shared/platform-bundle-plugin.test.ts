import { describe, expect, test } from "vitest";
import {
  createPlatformBundleDefinePlugin,
  platformBundleDefinePlugin,
} from "./platform-bundle-plugin";

const run = (code: string, plugin = platformBundleDefinePlugin): string | null => {
  const transform = plugin.transform as (code: string) => { code: string } | null;
  return transform(code)?.code ?? null;
};

describe("platformBundleDefinePlugin", () => {
  test("folds the gate member-expression to true", () => {
    expect(run("if (!process.env.__TAILOR_PLATFORM_BUNDLE) register();")).toBe(
      "if (!true) register();",
    );
  });

  test("skips source without the token", () => {
    expect(run("export const x = 1;")).toBeNull();
  });

  test("does not rewrite a longer key or a different owner", () => {
    const longerKey = "read(process.env.__TAILOR_PLATFORM_BUNDLE_MODE);";
    expect(run(longerKey)).toBe(longerKey);
    const otherOwner = "read(self.process.env.__TAILOR_PLATFORM_BUNDLE);";
    expect(run(otherOwner)).toBe(otherOwner);
  });
});

describe("createPlatformBundleDefinePlugin", () => {
  const code =
    "read(process.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_DATE, process.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_TEMPORAL);";

  test("keeps both date representations by default", () => {
    expect(run(code)).toBe("read(false, false);");
  });

  test("folds the gates of representations the bundle leaves out to true", () => {
    expect(run(code, createPlatformBundleDefinePlugin({ date: false, temporal: true }))).toBe(
      "read(true, false);",
    );
    expect(run(code, createPlatformBundleDefinePlugin({ date: true, temporal: false }))).toBe(
      "read(false, true);",
    );
  });
});
