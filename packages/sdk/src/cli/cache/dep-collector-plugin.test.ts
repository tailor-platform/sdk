import { describe, expect, test } from "vitest";
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
  test("returns an object with plugin and getResult", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    expect(plugin).toBeDefined();
    expect(getResult).toBeTypeOf("function");
  });

  test("plugin has name 'cache-dep-collector'", () => {
    const { plugin } = createDepCollectorPlugin();
    expect(plugin.name).toBe("cache-dep-collector");
  });

  test("getResult returns empty array initially", () => {
    const { getResult } = createDepCollectorPlugin();
    expect(getResult()).toEqual([]);
  });

  test("collects module IDs passed to the load handler", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/app/foo.ts");
    load("/src/app/bar.ts");

    const result = getResult();
    expect(result).toContain("/src/app/foo.ts");
    expect(result).toContain("/src/app/bar.ts");
  });

  test("excludes paths containing node_modules", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/app/index.ts");
    load("/project/node_modules/@tailor-platform/sdk/dist/index.js");
    load("/src/utils/helper.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/index.ts", "/src/utils/helper.ts"]);
  });

  test("returns sorted paths", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/z/last.ts");
    load("/src/a/first.ts");
    load("/src/m/middle.ts");

    const result = getResult();
    expect(result).toEqual(["/src/a/first.ts", "/src/m/middle.ts", "/src/z/last.ts"]);
  });

  test("deduplicates paths", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/app/foo.ts");
    load("/src/app/foo.ts");
    load("/src/app/bar.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/bar.ts", "/src/app/foo.ts"]);
  });

  test("excludes entry files (.entry.js)", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/app/index.ts");
    load("/dist/resolvers/myResolver.entry.js");
    load("/dist/executors/myExecutor.entry.js");
    load("/src/utils/helper.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/index.ts", "/src/utils/helper.ts"]);
  });

  test("collects non-JS files (JSON, CJS, etc.)", () => {
    const { plugin, getResult } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    load("/src/app/index.ts");
    load("/src/config/settings.json");
    load("/src/utils/legacy.cjs");

    const result = getResult();
    expect(result).toEqual([
      "/src/app/index.ts",
      "/src/config/settings.json",
      "/src/utils/legacy.cjs",
    ]);
  });

  test("handler returns null (does not modify code)", () => {
    const { plugin } = createDepCollectorPlugin();
    const load = extractLoadHandler(plugin);

    const result = load("/src/app/foo.ts");
    expect(result).toBeNull();
  });
});
