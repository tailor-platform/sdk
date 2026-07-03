import { beforeEach, describe, expect, test } from "vitest";
import { createDepCollectorPlugin } from "./dep-collector-plugin";
import type { Plugin } from "rolldown";

/**
 * Extract the load handler function from a rolldown plugin's load hook.
 * Handles both direct function and object-with-handler forms.
 * @param plugin - Rolldown plugin to extract the load handler from
 * @returns A callable function wrapping the load handler
 */
function extractLoadHandler(plugin: Plugin): (id: string) => unknown {
  const loadHook = plugin.load;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rolldown handler signature varies
  let handler: ((...args: any[]) => unknown) | undefined;
  if (typeof loadHook === "function") {
    handler = loadHook;
  } else if (typeof loadHook === "object" && "handler" in loadHook) {
    handler = loadHook.handler;
  }
  if (!handler) throw new Error("No load handler found on plugin");
  return (id: string) => handler(id);
}

describe("createDepCollectorPlugin", () => {
  let plugin: Plugin;
  let getResult: () => string[];
  let load: (id: string) => unknown;

  beforeEach(() => {
    ({ plugin, getResult } = createDepCollectorPlugin());
    load = extractLoadHandler(plugin);
  });

  test("returns an object with plugin and getResult", () => {
    expect(plugin).toBeDefined();
    expect(getResult).toBeTypeOf("function");
  });

  test("plugin has name 'cache-dep-collector'", () => {
    expect(plugin.name).toBe("cache-dep-collector");
  });

  test("getResult returns empty array initially", () => {
    expect(getResult()).toEqual([]);
  });

  test("collects module IDs passed to the load handler", () => {
    load("/src/app/foo.ts");
    load("/src/app/bar.ts");

    const result = getResult();
    expect(result).toContain("/src/app/foo.ts");
    expect(result).toContain("/src/app/bar.ts");
  });

  test.each([
    [
      "excludes paths containing node_modules",
      [
        "/src/app/index.ts",
        "/project/node_modules/@tailor-platform/sdk/dist/index.js",
        "/src/utils/helper.ts",
      ],
      ["/src/app/index.ts", "/src/utils/helper.ts"],
    ],
    [
      "returns sorted paths",
      ["/src/z/last.ts", "/src/a/first.ts", "/src/m/middle.ts"],
      ["/src/a/first.ts", "/src/m/middle.ts", "/src/z/last.ts"],
    ],
    [
      "deduplicates paths",
      ["/src/app/foo.ts", "/src/app/foo.ts", "/src/app/bar.ts"],
      ["/src/app/bar.ts", "/src/app/foo.ts"],
    ],
    [
      "excludes entry files (.entry.js)",
      [
        "/src/app/index.ts",
        "/dist/resolvers/myResolver.entry.js",
        "/dist/executors/myExecutor.entry.js",
        "/src/utils/helper.ts",
      ],
      ["/src/app/index.ts", "/src/utils/helper.ts"],
    ],
    [
      "collects non-JS files (JSON, CJS, etc.)",
      ["/src/app/index.ts", "/src/config/settings.json", "/src/utils/legacy.cjs"],
      ["/src/app/index.ts", "/src/config/settings.json", "/src/utils/legacy.cjs"],
    ],
  ])("%s", (_label, loaded, expected) => {
    for (const id of loaded) load(id);
    expect(getResult()).toEqual(expected);
  });

  test("handler returns null (does not modify code)", () => {
    const result = load("/src/app/foo.ts");
    expect(result).toBeNull();
  });
});
