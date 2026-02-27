import { describe, expect, test } from "vitest";
import { createDepCollectorPlugin } from "./dep-collector-plugin";

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

    // Extract the load handler from the plugin
    const loadHook = plugin.load;
    expect(loadHook).toBeDefined();

    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    // Simulate calling the handler with module IDs
    handler!.call(undefined as never, "/src/app/foo.ts");
    handler!.call(undefined as never, "/src/app/bar.ts");

    const result = getResult();
    expect(result).toContain("/src/app/foo.ts");
    expect(result).toContain("/src/app/bar.ts");
  });

  test("excludes paths containing node_modules", () => {
    const { plugin, getResult } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    handler!.call(undefined as never, "/src/app/index.ts");
    handler!.call(undefined as never, "/project/node_modules/@tailor-platform/sdk/dist/index.js");
    handler!.call(undefined as never, "/src/utils/helper.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/index.ts", "/src/utils/helper.ts"]);
  });

  test("returns sorted paths", () => {
    const { plugin, getResult } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    handler!.call(undefined as never, "/src/z/last.ts");
    handler!.call(undefined as never, "/src/a/first.ts");
    handler!.call(undefined as never, "/src/m/middle.ts");

    const result = getResult();
    expect(result).toEqual(["/src/a/first.ts", "/src/m/middle.ts", "/src/z/last.ts"]);
  });

  test("deduplicates paths", () => {
    const { plugin, getResult } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    handler!.call(undefined as never, "/src/app/foo.ts");
    handler!.call(undefined as never, "/src/app/foo.ts");
    handler!.call(undefined as never, "/src/app/bar.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/bar.ts", "/src/app/foo.ts"]);
  });

  test("excludes entry files (.entry.js)", () => {
    const { plugin, getResult } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    handler!.call(undefined as never, "/src/app/index.ts");
    handler!.call(undefined as never, "/dist/resolvers/myResolver.entry.js");
    handler!.call(undefined as never, "/dist/executors/myExecutor.entry.js");
    handler!.call(undefined as never, "/src/utils/helper.ts");

    const result = getResult();
    expect(result).toEqual(["/src/app/index.ts", "/src/utils/helper.ts"]);
  });

  test("collects non-JS files (JSON, CJS, etc.)", () => {
    const { plugin, getResult } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    handler!.call(undefined as never, "/src/app/index.ts");
    handler!.call(undefined as never, "/src/config/settings.json");
    handler!.call(undefined as never, "/src/utils/legacy.cjs");

    const result = getResult();
    expect(result).toEqual([
      "/src/app/index.ts",
      "/src/config/settings.json",
      "/src/utils/legacy.cjs",
    ]);
  });

  test("handler returns null (does not modify code)", () => {
    const { plugin } = createDepCollectorPlugin();

    const loadHook = plugin.load;
    const handler =
      typeof loadHook === "function"
        ? loadHook
        : typeof loadHook === "object" && loadHook !== null && "handler" in loadHook
          ? loadHook.handler
          : undefined;
    expect(handler).toBeDefined();

    const result = handler!.call(undefined as never, "/src/app/foo.ts");
    expect(result).toBeNull();
  });
});
