import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TraceMap } from "@jridgewell/trace-mapping";
import { build } from "rolldown";
import { describe, expect, test } from "vitest";
import { originalPositionAt } from "#/cli/shared/test-helpers/sourcemap";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { assertDefined } from "#/utils/assert";
import {
  createPlatformBundleDefinePlugin,
  platformBundleDefinePlugin,
} from "./platform-bundle-plugin";

const run = (code: string, plugin = platformBundleDefinePlugin): string | null => {
  const transform = plugin.transform as (code: string) => { code: string } | null;
  return transform(code)?.code ?? null;
};

describe("platformBundleDefinePlugin", () => {
  test.each([
    "process.env.__TAILOR_PLATFORM_BUNDLE",
    "globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_DATE",
    "globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_WITHOUT_TEMPORAL",
    "globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT",
    "globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL",
  ])("preserves error positions after folding %s", async (gate) => {
    using tmp = tempDir("platform-sourcemap-");
    const sourceLines = [
      `export function main() { if (${gate}) throw new Error("GATE"); }`,
      `export function later() { throw new Error("LATER"); }`,
    ];
    const sourceFile = join(tmp.dir, "function.js");
    writeFileSync(sourceFile, sourceLines.join("\n"));
    const result = await build({
      input: sourceFile,
      plugins: [createPlatformBundleDefinePlugin({ date: false, temporal: false }, "date", true)],
      output: { format: "esm", sourcemap: true, minify: true },
      write: false,
    });
    const chunk = result.output[0];
    expect(chunk.type).toBe("chunk");
    const traceMap = new TraceMap(assertDefined(chunk.map, "sourcemap missing").toString());
    for (const [index, message] of ["GATE", "LATER"].entries()) {
      const messageOffset = chunk.code.indexOf(message);
      expect(messageOffset).toBeGreaterThan(-1);
      expect(
        originalPositionAt(traceMap, chunk.code, chunk.code.lastIndexOf("throw", messageOffset)),
      ).toMatchObject({
        line: index + 1,
        column: assertDefined(sourceLines[index], "source line missing").indexOf("throw"),
      });
    }
  });

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

describe("createPlatformBundleDefinePlugin kysely temporal", () => {
  const code = "read(globalThis.process?.env.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL);";

  test("folds the kysely temporal gate to undefined unless the plugin is configured with temporal", () => {
    expect(run(code)).toBe("read(undefined);");
    expect(run(code, createPlatformBundleDefinePlugin(undefined, "legacy", false))).toBe(
      "read(undefined);",
    );
  });

  test("folds the kysely temporal gate to the string true when the plugin is configured with temporal", () => {
    expect(run(code, createPlatformBundleDefinePlugin(undefined, "legacy", true))).toBe(
      'read("true");',
    );
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

describe("kysely temporal gate in the built runtime", () => {
  // `getDB` of `@tailor-platform/sdk/plugin/kysely-type/db` reads the gate from dist. If tsdown
  // ever emitted it in a shape the regex does not match, a deployed function would silently
  // read Date and string values while the project's types say Temporal.
  test("the built db module reads the gate in the exact shape the plugin folds", () => {
    const built = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "dist",
        "plugin",
        "builtin",
        "kysely-type",
        "db.mjs",
      ),
      "utf8",
    );

    const folded = run(built, createPlatformBundleDefinePlugin(undefined, "legacy", true));
    expect(folded).not.toContain("__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL");
    expect(folded).toContain('"true"===`true`');
  });
});
