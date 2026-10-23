import * as fs from "node:fs";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  collectFunctionEntries,
  planFunctionRegistry,
} from "#/cli/commands/deploy/function-registry";
import { planPipeline } from "#/cli/commands/deploy/resolver";
import { createGenerationManager } from "#/cli/commands/generate/service";
import { logger } from "#/cli/shared/logger";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { defineConfig } from "#/configure/config/index";
import { t } from "#/configure/types/type";
import { PluginManager } from "#/plugin/manager";
import { defineApplication, loadApplication } from "./application";
import type { OperatorClient } from "#/cli/shared/client";

describe("plugin-generated resolvers", () => {
  let baseDir: string;
  let externalOutputDir: string;

  aroundEach(async (runTest) => {
    baseDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".plugin-resolvers-")));
    externalOutputDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "plugin-resolvers-")),
    );
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(baseDir, ".tailor"));
    vi.stubGlobal("tailor", { context: { getInvoker: () => null } });
    vi.stubGlobal(
      "TailorErrors",
      class extends Error {
        constructor(issues: unknown) {
          super(JSON.stringify(issues));
        }
      },
    );
    try {
      await runTest();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      fs.rmSync(baseDir, { recursive: true, force: true });
      fs.rmSync(externalOutputDir, { recursive: true, force: true });
    }
  });

  test.each(["project", "external"])(
    "loads, bundles, and plans namespace output in a %s build directory",
    async (outputLocation) => {
      if (outputLocation === "external") vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", externalOutputDir);
      const pluginManager = new PluginManager([
        {
          id: "greeting",
          description: "Generate a greeting query",
          onNamespaceLoaded: () => ({
            resolvers: [
              {
                name: "greet",
                operation: "query",
                inputFields: { name: t.string() },
                outputFields: { message: t.string() },
                body: "return { message: `Hello, ${context.input.name}!` };",
              },
            ],
          }),
        },
      ]);
      const config = {
        ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
        path: path.join(baseDir, "tailor.config.ts"),
      };

      const { application, bundledScripts } = await loadApplication({ config, pluginManager });

      expect(application.subgraphs).toContainEqual({ Type: "pipeline", Name: "main" });
      expect(application.resolverServices).toHaveLength(1);
      expect(Object.values(application.resolverServices[0]!.resolvers)).toMatchObject([
        { name: "greet", operation: "query", output: { fields: { message: { type: "string" } } } },
      ]);
      const code = bundledScripts.resolvers.get("main:greet");
      expect(code).toBeDefined();
      const bundleFile = path.join(baseDir, "greet.mjs");
      fs.writeFileSync(bundleFile, code!);
      const { main } = await import(pathToFileURL(bundleFile).href);
      await expect(main({ input: { name: "Tailor" } })).resolves.toEqual({
        message: "Hello, Tailor!",
      });

      const client = {
        listPipelineServices: vi.fn().mockResolvedValue({ pipelineServices: [] }),
        listPipelineResolvers: vi.fn().mockResolvedValue({ pipelineResolvers: [] }),
        listFunctionRegistries: vi.fn().mockResolvedValue({ functions: [] }),
      } as unknown as OperatorClient;
      const pipelinePlan = await planPipeline({
        client,
        workspaceId: "ws",
        application,
        config,
        forRemoval: false,
      });
      expect(pipelinePlan.changeSet.service.creates).toMatchObject([{ name: "main" }]);
      expect(pipelinePlan.changeSet.resolver.creates).toMatchObject([
        { name: "greet", request: { namespaceName: "main", pipelineResolver: { name: "greet" } } },
      ]);
      const entries = collectFunctionEntries(application, [], bundledScripts);
      const functionPlan = await planFunctionRegistry(
        client,
        "ws",
        application.name,
        undefined,
        entries,
      );
      expect(functionPlan.changeSet.creates).toMatchObject([{ name: "resolver--main--greet" }]);
    },
  );

  test("includes table plugin resolvers in generation and preserves configured resolver files", async () => {
    fs.writeFileSync(
      path.join(baseDir, "order.ts"),
      `
      import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
      export const order = db.table("Order", { name: db.string() })
        .permission(unsafeAllowAllTypePermission).gqlPermission(unsafeAllowAllGqlPermission)
        .plugin({ greeting: {} });
    `,
    );
    fs.writeFileSync(
      path.join(baseDir, "manual.ts"),
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      export default createResolver({ name: "manual", operation: "query", body: () => 1, output: t.int() });
    `,
    );
    const pluginManager = new PluginManager([
      {
        id: "greeting",
        description: "Table query",
        importPath: "@example/greeting",
        onTableLoaded: ({ table }) => ({
          resolvers: [
            {
              name: `get${table.name}`,
              operation: "query",
              outputFields: { name: t.string() },
              body: 'return { name: "Order" };',
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({
        name: "test-app",
        db: { main: { files: ["./order.ts"] } },
        resolver: { main: { files: ["./manual.ts"], defaultPermission: "allowAnonymous" } },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const application = defineApplication({ config, pluginManager });
    const generation = createGenerationManager({ application, config, pluginManager });
    await generation.generate();
    expect(Object.keys(generation.services.resolver.main!).toSorted()).toEqual([
      "getOrder",
      "manual",
    ]);
    expect(application.resolverServices[0]!.defaultPermission).toBe("allowAnonymous");
  });

  test("includes resolver namespaces that only plugins generate into in generation", async () => {
    const pluginManager = new PluginManager([
      {
        id: "greeting",
        description: "Query",
        onNamespaceLoaded: () => ({
          resolvers: [{ name: "greet", operation: "query", outputFields: {}, body: "return {};" }],
        }),
      },
    ]);
    const config = {
      ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const application = defineApplication({ config, pluginManager });
    const generation = createGenerationManager({ application, config, pluginManager });
    await generation.generate();
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(Object.keys(generation.services.resolver.main!)).toEqual(["greet"]);
    expect(warnings.filter((message) => message.startsWith("No resolver files found"))).toEqual([]);
  });

  test("bundles generated resolvers when the build directory contains glob characters", async () => {
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(baseDir, "out [v2] {a}"));
    const pluginManager = new PluginManager([
      {
        id: "greeting",
        description: "Query",
        onNamespaceLoaded: () => ({
          resolvers: [{ name: "greet", operation: "query", outputFields: {}, body: "return {};" }],
        }),
      },
    ]);
    const config = {
      ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const { bundledScripts } = await loadApplication({ config, pluginManager });
    expect(bundledScripts.resolvers.has("main:greet")).toBe(true);
  });

  test("generates resolver files at the same project-relative path in every checkout", async () => {
    const generatedFiles: string[][] = [];
    for (const checkout of ["checkout-1", "checkout-2"]) {
      const pluginManager = new PluginManager([
        {
          id: "greeting",
          description: "Query",
          onNamespaceLoaded: () => ({
            resolvers: [
              { name: "greet", operation: "query", outputFields: {}, body: "return {};" },
            ],
          }),
        },
      ]);
      const projectDir = path.join(baseDir, checkout);
      vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(projectDir, ".tailor"));
      const config = {
        ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
        path: path.join(projectDir, "tailor.config.ts"),
      };
      const { application } = await loadApplication({ config, pluginManager });
      generatedFiles.push(
        Object.keys(application.resolverServices[0]!.resolvers).map((file) =>
          path.relative(projectDir, file),
        ),
      );
    }
    expect(generatedFiles[1]).toEqual(generatedFiles[0]);
  });

  test("warns about unmatched resolver patterns when plugins generate resolvers", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const pluginManager = new PluginManager([
      {
        id: "greeting",
        description: "Query",
        onNamespaceLoaded: () => ({
          resolvers: [{ name: "greet", operation: "query", outputFields: {}, body: "return {};" }],
        }),
      },
    ]);
    const config = {
      ...defineConfig({
        name: "test-app",
        db: { main: { files: [] } },
        resolver: { main: { files: ["./missing/*.ts"] } },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    await loadApplication({ config, pluginManager });
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings).toContainEqual(
      'No resolver files found for namespace "main" matching ./missing/*.ts',
    );
  });

  test("preserves explicit ignore overrides when bundling loaded resolver files", async () => {
    fs.writeFileSync(
      path.join(baseDir, "allowed.test.ts"),
      `
      import { createResolver, t } from "@tailor-platform/sdk";
      export default createResolver({ name: "allowed", operation: "query", body: () => 1, output: t.int() });
    `,
    );
    const config = {
      ...defineConfig({
        name: "test-app",
        resolver: {
          main: { files: ["./allowed.test.ts"], ignores: [] },
        },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const { bundledScripts } = await loadApplication({ config });
    expect(bundledScripts.resolvers.has("main:allowed")).toBe(true);
  });

  test("does not reload stale generated resolvers matched by configured globs", async () => {
    const resolver = {
      name: "old",
      operation: "query" as const,
      outputFields: {},
      body: "return {};",
    };
    const config = {
      ...defineConfig({
        name: "test-app",
        db: { main: { files: [] } },
        resolver: {
          main: { files: ["./.tailor/plugin/resolvers/**/*.ts"] },
        },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const firstManager = new PluginManager([
      {
        id: "greeting",
        description: "Query",
        onNamespaceLoaded: () => ({ resolvers: [resolver] }),
      },
    ]);
    await loadApplication({ config, pluginManager: firstManager });
    beginUserModuleRun();
    const { application, bundledScripts } = await loadApplication({
      config,
      pluginManager: new PluginManager([]),
    });
    expect(Object.values(application.resolverServices[0]!.resolvers)).toEqual([]);
    expect(bundledScripts.resolvers.size).toBe(0);
  });

  test("preserves date conversion, field validators, and namespace permissions in bundled output", async () => {
    const pluginManager = new PluginManager([
      {
        id: "dates",
        description: "Date query",
        onNamespaceLoaded: () => ({
          resolvers: [
            {
              name: "day",
              operation: "query",
              body: "return { day: context.input.day };",
              inputFields: {
                day: t
                  .date({ as: "date" })
                  .validate(({ value }) =>
                    value instanceof Date && value.getUTCFullYear() === 2026
                      ? undefined
                      : "Expected a date in 2026",
                  ),
              },
              outputFields: { day: t.date({ as: "date" }) },
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({
        name: "test-app",
        db: { main: { files: [] } },
        resolver: {
          main: {
            files: [],
            defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
          },
        },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const { bundledScripts } = await loadApplication({ config, pluginManager });
    const code = bundledScripts.resolvers.get("main:day");
    expect(code).toBeDefined();
    const bundleFile = path.join(baseDir, "day.mjs");
    fs.writeFileSync(bundleFile, code!);
    const { main } = await import(pathToFileURL(bundleFile).href);
    await expect(main({ input: { day: "2026-10-22" }, caller: null })).rejects.toThrow(
      "access denied",
    );
    await expect(main({ input: { day: "2025-10-22" }, caller: { id: "user" } })).rejects.toThrow(
      "Expected a date in 2026",
    );
    await expect(main({ input: { day: "2026-10-22" }, caller: { id: "user" } })).resolves.toEqual({
      day: "2026-10-22",
    });
  });

  test("rejects field validators that capture plugin-local variables", async () => {
    const allowedValue = "Tailor";
    const pluginManager = new PluginManager([
      {
        id: "closure",
        description: "Captured validator",
        onNamespaceLoaded: () => ({
          resolvers: [
            {
              name: "greet",
              operation: "query",
              outputFields: {},
              body: "return {};",
              inputFields: {
                name: t
                  .string()
                  .validate(({ value }) => (value === allowedValue ? undefined : "Invalid name")),
              },
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    await expect(loadApplication({ config, pluginManager })).rejects.toThrow(
      /plugin "closure".*self-contained.*allowedValue/s,
    );
  });

  test("keeps the same resolver name separate across namespaces", async () => {
    const pluginManager = new PluginManager([
      {
        id: "queries",
        description: "Namespace query",
        onNamespaceLoaded: ({ namespace }) => ({
          resolvers: [
            {
              name: "namespace",
              operation: "query",
              outputFields: { name: t.string() },
              body: `return { name: ${JSON.stringify(namespace)} };`,
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({ name: "test-app", db: { first: { files: [] }, second: { files: [] } } }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    const { application, bundledScripts } = await loadApplication({ config, pluginManager });
    expect(application.resolverServices.map((service) => service.namespace)).toEqual([
      "first",
      "second",
    ]);
    expect([...bundledScripts.resolvers.keys()].toSorted()).toEqual([
      "first:namespace",
      "second:namespace",
    ]);
    await pluginManager.processNamespacePlugins("first");
    expect(pluginManager.getPluginGeneratedResolvers()).toHaveLength(2);
  });

  test("does not reuse another application's generated resolver module", async () => {
    const firstManager = new PluginManager([
      {
        id: "queries",
        description: "First application",
        onNamespaceLoaded: () => ({
          resolvers: [
            {
              name: "value",
              operation: "query",
              outputFields: { value: t.string() },
              body: 'return { value: "first" };',
            },
          ],
        }),
      },
    ]);
    const secondManager = new PluginManager([
      {
        id: "queries",
        description: "Second application",
        onNamespaceLoaded: () => ({
          resolvers: [
            {
              name: "value",
              operation: "query",
              outputFields: { value: t.int() },
              body: "return { value: 2 };",
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({ name: "first-app", db: { main: { files: [] } } }),
      path: path.join(baseDir, "first.config.ts"),
    };
    const [first, { application }] = await Promise.all([
      loadApplication({ config, pluginManager: firstManager }),
      loadApplication({
        config: { ...config, name: "second-app", path: path.join(baseDir, "second.config.ts") },
        pluginManager: secondManager,
      }),
    ]);
    expect(Object.values(first.application.resolverServices[0]!.resolvers)).toMatchObject([
      { name: "value", output: { fields: { value: { type: "string" } } } },
    ]);
    expect(Object.values(application.resolverServices[0]!.resolvers)).toMatchObject([
      { name: "value", output: { fields: { value: { type: "integer" } } } },
    ]);
  });

  test("keeps another application's generated resolvers when a name is a dot segment", async () => {
    const createManager = () =>
      new PluginManager([
        {
          id: "greeting",
          description: "Query",
          onNamespaceLoaded: () => ({
            resolvers: [
              { name: "greet", operation: "query", outputFields: {}, body: "return {};" },
            ],
          }),
        },
      ]);
    const { application } = await loadApplication({
      config: {
        ...defineConfig({ name: "main", db: { other: { files: [] } } }),
        path: path.join(baseDir, "main.config.ts"),
      },
      pluginManager: createManager(),
    });
    const files = Object.keys(application.resolverServices[0]!.resolvers);
    expect(files).toHaveLength(1);
    await loadApplication({
      config: {
        ...defineConfig({ name: ".", db: { main: { files: [] } } }),
        path: path.join(baseDir, "dot.config.ts"),
      },
      pluginManager: createManager(),
    });
    expect(files.filter((file) => !fs.existsSync(file))).toEqual([]);
  });

  test.each([
    {
      name: "invalid field",
      outputFields: { bad: { type: "unknown", metadata: {}, fields: {} } },
      body: "return {};",
      reason: /output/,
      code: "DEFINITION_INVALID",
    },
    {
      name: "invalid body",
      outputFields: {},
      body: "return {;",
      reason: /Invalid JavaScript/,
      code: "PLUGIN_RESOLVER_INVALID",
    },
  ])(
    "rejects $name with plugin and namespace context",
    async ({ outputFields, body, reason, code }) => {
      const pluginManager = new PluginManager([
        {
          id: "broken",
          description: "Invalid query",
          onNamespaceLoaded: () => ({
            resolvers: [
              {
                name: "brokenQuery",
                operation: "query",
                outputFields,
                body,
              },
            ],
          }),
        },
      ]);
      const config = {
        ...defineConfig({ name: "test-app", db: { main: { files: [] } } }),
        path: path.join(baseDir, "tailor.config.ts"),
      };
      await expect(loadApplication({ config, pluginManager })).rejects.toThrow(
        /resolver "brokenQuery" from plugin "broken" in namespace "main"/,
      );
      await expect(loadApplication({ config, pluginManager })).rejects.toThrow(reason);
      await expect(loadApplication({ config, pluginManager })).rejects.toMatchObject({
        code,
        context: { pluginId: "broken", namespace: "main", resolverName: "brokenQuery" },
      });
    },
  );

  test.each(["generated", "configured"])(
    "rejects names duplicated by a %s resolver before bundling",
    async (source) => {
      const definition = {
        name: "duplicate",
        operation: "query" as const,
        outputFields: {},
        body: "return {};",
      };
      fs.writeFileSync(
        path.join(baseDir, "duplicate.ts"),
        `
      import { createResolver } from "@tailor-platform/sdk";
      export default createResolver({ name: "duplicate", operation: "query", output: {}, body: () => ({}) });
    `,
      );
      const pluginManager = new PluginManager([
        {
          id: "queries",
          description: "Duplicate query",
          onNamespaceLoaded: () => ({
            resolvers: source === "generated" ? [definition, definition] : [definition],
          }),
        },
      ]);
      const config = {
        ...defineConfig({
          name: "test-app",
          db: { main: { files: [] } },
          resolver: {
            main: { files: source === "configured" ? ["./duplicate.ts"] : [] },
          },
        }),
        path: path.join(baseDir, "tailor.config.ts"),
      };
      await expect(loadApplication({ config, pluginManager })).rejects.toThrow(
        /Duplicate resolver name "duplicate" found in namespace "main"/,
      );
    },
  );

  test("rejects generated resolvers targeting an attached namespace", async () => {
    const pluginManager = new PluginManager([
      {
        id: "queries",
        description: "Query",
        onNamespaceLoaded: () => ({
          resolvers: [
            {
              name: "query",
              operation: "query",
              outputFields: {},
              body: "return {};",
            },
          ],
        }),
      },
    ]);
    const config = {
      ...defineConfig({
        name: "test-app",
        db: { main: { files: [] } },
        resolver: { main: { attach: true } },
      }),
      path: path.join(baseDir, "tailor.config.ts"),
    };
    await expect(loadApplication({ config, pluginManager })).rejects.toThrow(
      /Plugin "queries" cannot generate resolvers in namespace "main", which is owned by another application/,
    );
    await expect(loadApplication({ config, pluginManager })).rejects.toMatchObject({
      code: "PLUGIN_RESOLVER_NAMESPACE_EXTERNAL",
      context: { pluginId: "queries", namespace: "main" },
    });
    const application = defineApplication({ config, pluginManager });
    await expect(
      createGenerationManager({ application, config, pluginManager }).generate(),
    ).rejects.toMatchObject({ code: "PLUGIN_RESOLVER_NAMESPACE_EXTERNAL" });
  });
});
