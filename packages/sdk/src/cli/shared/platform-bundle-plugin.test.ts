import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
    "read(globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_DATE, globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_TEMPORAL);";

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

describe("createPlatformBundleDefinePlugin date default", () => {
  const code = "read(globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT);";

  test("folds the date default gate to undefined when the bundle keeps the legacy default", () => {
    expect(run(code)).toBe("read(undefined);");
    expect(
      run(code, createPlatformBundleDefinePlugin({ date: true, temporal: true }, "legacy")),
    ).toBe("read(undefined);");
  });

  test("folds the date default gate to the configured representation literal", () => {
    expect(
      run(code, createPlatformBundleDefinePlugin({ date: true, temporal: true }, "temporal")),
    ).toBe('read("temporal");');
    expect(
      run(code, createPlatformBundleDefinePlugin({ date: true, temporal: true }, "date")),
    ).toBe('read("date");');
  });

  test("the bare gate fold does not eat the date default gate", () => {
    const both =
      "a(process.env.__TAILOR_PLATFORM_BUNDLE, globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT);";
    expect(run(both)).toBe("a(true, undefined);");
  });
});

describe("date default gate in the built runtime", () => {
  // The gate is read by the SDK's own runtime code, which user bundles pull in
  // from dist. If tsdown ever emitted it in a shape the regex does not match,
  // a deployed function would silently fall back to string values.
  test("the built chunk reads the gate in the exact shape the plugin folds", () => {
    const distDir = join(import.meta.dirname, "..", "..", "..", "dist");
    const chunk = readdirSync(distDir)
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => readFileSync(join(distDir, name), "utf8"))
      .find((code) => code.includes("function bundledDateDefault"));
    expect(
      chunk,
      "run `pnpm build` first: dist has no chunk with bundledDateDefault",
    ).toBeDefined();

    const folded = run(chunk!, createPlatformBundleDefinePlugin(undefined, "temporal"));
    expect(folded).not.toContain("__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT");
    expect(folded).toMatch(/="temporal";return \w+===`temporal`\|\|\w+===`date`\?\w+:`legacy`/);
  });
});
