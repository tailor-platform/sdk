import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from "vitest";
import { defineApplication, defineWorkspaceServices } from "#/cli/services/application";
import { errorToJson, serializeError } from "#/cli/shared/error-json";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadedWorkspace } from "#/cli/shared/test-helpers/workspace-config";
import { defineWorkspace } from "#/configure/config/workspace";
import { defineAuth } from "#/configure/services/auth/index";
import { PluginManager } from "#/plugin/manager";
import { createGenerationManager } from "./service";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { Plugin } from "#/plugin/types";

vi.mock("node:fs", () => {
  return {
    writeFile: vi.fn((_, _2, callback) => {
      if (typeof callback === "function") callback(null);
    }),
    mkdirSync: vi.fn(() => ""),
    mkdtempSync: vi.fn((prefix: string) => `${prefix}xxxxxx`),
    rmSync: vi.fn(() => {}),
    existsSync: vi.fn(() => true),
    globSync: vi.fn(() => []),
  };
});

vi.mock("#/cli/shared/logger", async (importOriginal) => {
  const actual = await importOriginal<{
    logger?: Record<string, unknown>;
    styles?: Record<string, unknown>;
    symbols?: Record<string, unknown>;
  }>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      log: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      newline: vi.fn(),
      out: vi.fn(),
    },
  };
});

function loadedTailorDBService(namespace: string, tableNames: string[]): TailorDBService {
  const types = Object.fromEntries(
    tableNames.map((tableName) => [tableName, { name: tableName } as TailorDBType]),
  );
  const typeSourceInfo = Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      {
        filePath: `${namespace}/${tableName}.ts`,
        exportName: tableName,
      },
    ]),
  );

  return {
    namespace,
    config: { files: [] },
    types,
    typeSourceInfo,
    pluginAttachments: new Map(),
    loadTypes: vi.fn().mockResolvedValue(types),
    processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
  };
}

function applicationWithTailorDBServices(
  config: LoadedConfig,
  tailorDBServices: TailorDBService[],
): Application {
  return {
    ...defineApplication({ config: { ...config, db: {} } }),
    tailorDBServices,
  };
}

describe("GenerationManager", () => {
  let tempDir: string;
  let mockConfig: LoadedConfig;

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "generation-manager-test-"));

    mockConfig = {
      name: "testApp",
      path: "tailor.config.ts",
      db: { main: { files: ["src/types/*.ts"] } },
      resolver: { main: { files: ["src/resolvers/*.ts"] } },
    };
  });

  afterEach(() => {
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.mkdirSync).mockClear();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("constructor", () => {
    test("initializes without legacy generator API", () => {
      const application = defineApplication({ config: mockConfig });
      const manager = createGenerationManager({
        configServices: application,
        config: mockConfig,
      });

      expect(manager.configServices).toBe(application);
      expect(manager.baseDir).toContain("generated");
      expect(manager.services).toEqual({ tailordb: {}, resolver: {}, executor: {} });
      expect("generators" in manager).toBe(false);
      expect("generatorResults" in manager).toBe(false);
      expect("processGenerator" in manager).toBe(false);
    });

    test("creates base directory", () => {
      const application = defineApplication({ config: mockConfig });
      createGenerationManager({
        configServices: application,
        config: mockConfig,
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("generated"), {
        recursive: true,
      });
    });
  });

  describe("generate", () => {
    test("executes complete generation process", async () => {
      const application = defineApplication({ config: mockConfig });
      const manager = createGenerationManager({
        configServices: application,
        config: mockConfig,
      });

      await manager.generate();

      expect(manager.services).toBeDefined();
    });

    test("runs plugin generation hooks after TailorDB load", async () => {
      const onTailorDBReady = vi.fn().mockResolvedValue({
        files: [{ path: path.join(tempDir, "generated.txt"), content: "generated" }],
      });
      const plugin: Plugin = {
        id: "test-plugin",
        description: "Test plugin",
        onTailorDBReady,
      };
      const application = applicationWithTailorDBServices(mockConfig, [
        loadedTailorDBService("main", ["User"]),
      ]);
      const pluginManager = new PluginManager([plugin]);
      const manager = createGenerationManager({
        configServices: application,
        config: mockConfig,
        pluginManager,
      });

      await manager.generate();

      expect(onTailorDBReady).toHaveBeenCalledWith(
        expect.objectContaining({
          tailordb: [
            expect.objectContaining({
              namespace: "main",
              tables: expect.objectContaining({ User: expect.objectContaining({ name: "User" }) }),
            }),
          ],
          baseDir: expect.stringContaining("test-plugin"),
          configPath: "tailor.config.ts",
        }),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(tempDir, "generated.txt"),
        "generated",
        expect.any(Function),
      );
    });

    test("reports a failed plugin while another plugin is still pending", async () => {
      const siblingStarted = Promise.withResolvers<void>();
      const finishSibling = Promise.withResolvers<void>();
      const config = { ...mockConfig, db: {}, resolver: {} };
      const manager = createGenerationManager({
        configServices: defineApplication({ config }),
        config,
        pluginManager: new PluginManager([
          {
            id: "early-failure-plugin",
            description: "Fails before its sibling completes",
            onTailorDBReady: async () => {
              throw new Error("early-failure-sentinel");
            },
          },
          {
            id: "pending-plugin",
            description: "Waits for release",
            onTailorDBReady: async () => {
              siblingStarted.resolve();
              await finishSibling.promise;
              return { files: [] };
            },
          },
        ]),
      });
      const failure = manager.generate().catch((error: unknown) => error);
      await siblingStarted.promise;
      try {
        await vi.waitFor(() => {
          expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("early-failure-sentinel"),
          );
        });
      } finally {
        finishSibling.resolve();
        await failure;
      }
      expect(errorToJson(await failure).error.code).toBe("PLUGIN_GENERATION_FAILED");
    });

    test.each(["onTailorDBReady", "onResolverReady", "onExecutorReady"] as const)(
      "preserves plugin failures from %s in human and JSON diagnostics",
      async (hookName) => {
        const config = { ...mockConfig, db: {}, resolver: {} };
        const firstError = CLIError({
          code: "PLUGIN_INPUT_MISSING",
          message: "Missing first-plugin input",
          suggestion: "Create the input file.",
          next: { command: "tailor", args: ["generate"] },
          context: { file: "plugin-input.json" },
        });
        const secondError = new ConnectError("Second-plugin access denied", Code.PermissionDenied);
        const firstHook = vi.fn(async () => {
          await Promise.resolve();
          throw firstError;
        });
        const successfulHook = vi.fn(async () => ({ files: [] }));
        const secondHook = vi.fn(async () => {
          throw secondError;
        });
        const stringHook = vi.fn().mockRejectedValue("Third-plugin string failure");
        const plugins: Plugin[] = [
          { id: "first-plugin", description: "First", [hookName]: firstHook },
          { id: "successful-plugin", description: "Successful", [hookName]: successfulHook },
          { id: "second-plugin", description: "Second", [hookName]: secondHook },
          { id: "third-plugin", description: "Third", [hookName]: stringHook },
        ];
        const manager = createGenerationManager({
          configServices: defineApplication({ config }),
          config,
          pluginManager: new PluginManager(plugins),
        });
        const failure = await manager.generate().then(
          () => {
            throw new Error("Expected plugin generation to fail");
          },
          (error: unknown) => error,
        );

        expect(isCLIError(failure)).toBe(true);
        if (!isCLIError(failure)) throw new Error("Expected structured plugin failure");
        expect(JSON.parse(serializeError(failure))).toMatchObject({
          error: {
            code: "PLUGIN_GENERATION_FAILED",
            message: `Plugin generation failed during ${hookName}.`,
            context: {
              hook: hookName,
              failures: [
                { plugin: "first-plugin", error: errorToJson(firstError).error },
                { plugin: "second-plugin", error: errorToJson(secondError).error },
                {
                  plugin: "third-plugin",
                  error: { code: "UNKNOWN_ERROR", message: "Third-plugin string failure" },
                },
              ],
            },
          },
        });
        const humanOutput = failure.format();
        for (const marker of [
          hookName,
          "first-plugin",
          firstError.message,
          "Create the input file.",
          "tailor generate",
          "second-plugin",
          secondError.message,
          "third-plugin",
          "Third-plugin string failure",
        ]) {
          expect(humanOutput).toContain(marker);
        }
        expect(humanOutput).not.toContain("successful-plugin");
        for (const hook of [firstHook, successfulHook, secondHook, stringHook]) {
          expect(hook).toHaveBeenCalledOnce();
        }
      },
    );

    test.each(["onTailorDBReady", "onResolverReady", "onExecutorReady"] as const)(
      "passes %s every Auth service as auths, and the only one as auth",
      async (hookName) => {
        const received: unknown[] = [];
        const hook = vi.fn(async (ctx: { auth?: unknown; auths: Record<string, unknown> }) => {
          received.push({ auth: ctx.auth, auths: ctx.auths });
          return { files: [] };
        });
        const auth = defineAuth("corp-auth", { machineUserAttributes: {}, machineUsers: {} });
        for (const config of [
          { ...mockConfig, db: {}, resolver: {}, auth },
          { ...mockConfig, db: {}, resolver: {} },
        ]) {
          await createGenerationManager({
            configServices: defineApplication({ config }),
            config,
            pluginManager: new PluginManager([{ id: "p", description: "P", [hookName]: hook }]),
          }).generate();
        }

        const corpAuth = expect.objectContaining({ name: "corp-auth" });
        expect(received).toEqual([
          { auth: corpAuth, auths: { "corp-auth": corpAuth } },
          { auth: undefined, auths: {} },
        ]);
      },
    );

    test.each(["onTailorDBReady", "onResolverReady", "onExecutorReady"] as const)(
      "fails %s that reads auth when the workspace has several Auth services",
      async (hookName) => {
        const workspace = loadedWorkspace(
          defineWorkspace({
            auth: {
              "corp-auth": defineAuth("corp-auth", { machineUserAttributes: {}, machineUsers: {} }),
              "partner-auth": defineAuth("partner-auth", {
                machineUserAttributes: {},
                machineUsers: {},
              }),
            },
            apps: {},
          }),
        );
        const hook = vi.fn(async (ctx: { auth?: unknown }) => {
          void ctx.auth;
          return { files: [] };
        });

        const failure = createGenerationManager({
          configServices: defineWorkspaceServices({ workspace }),
          config: workspace,
          pluginManager: new PluginManager([{ id: "p", description: "P", [hookName]: hook }]),
        }).generate();

        await expect(failure).rejects.toMatchObject({
          code: "PLUGIN_GENERATION_FAILED",
          context: {
            failures: [
              {
                plugin: "p",
                error: expect.objectContaining({ code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS" }),
              },
            ],
          },
        });
      },
    );

    test("rejects duplicate TailorDB table names between namespaces", async () => {
      const duplicateApp = applicationWithTailorDBServices(mockConfig, [
        loadedTailorDBService("main", ["User"]),
        loadedTailorDBService("analytics", ["User"]),
      ]);
      const duplicateManager = createGenerationManager({
        configServices: duplicateApp,
        config: mockConfig,
      });

      await expect(duplicateManager.generate()).rejects.toMatchObject({
        message: expect.stringMatching(/Duplicate TailorDB type name "User"/),
        suggestion:
          "Give each TailorDB type a name that is unique across all TailorDB namespaces in the application.",
      });
      expect(vi.mocked(logger.error).mock.calls).toEqual([
        ["Error validating TailorDB table names"],
      ]);
    });

    test("names the TailorDB service whose tables fail to load, leaving the error to the caller", async () => {
      const loadFailure = new Error("table load failed");
      const application = applicationWithTailorDBServices(mockConfig, [
        {
          ...loadedTailorDBService("main", []),
          loadTypes: vi.fn().mockRejectedValue(loadFailure),
        },
      ]);
      const manager = createGenerationManager({
        configServices: application,
        config: mockConfig,
      });

      await expect(manager.generate()).rejects.toBe(loadFailure);
      expect(vi.mocked(logger.error).mock.calls).toEqual([
        [expect.stringMatching(/Error loading tables for TailorDB service .*main/)],
      ]);
    });

    test("names the Resolver service whose resolvers fail to load, leaving the error to the caller", async () => {
      const loadFailure = new Error("resolver load failed");
      const config = { ...mockConfig, db: {}, resolver: {} };
      const application: Application = {
        ...defineApplication({ config }),
        resolverServices: [
          {
            namespace: "main",
            config: { files: [] },
            defaultPermission: undefined,
            resolvers: {},
            loadResolvers: vi.fn().mockRejectedValue(loadFailure),
          },
        ],
      };
      const manager = createGenerationManager({ configServices: application, config });

      await expect(manager.generate()).rejects.toBe(loadFailure);
      expect(vi.mocked(logger.error).mock.calls).toEqual([
        [expect.stringMatching(/Error loading resolvers for Resolver service .*main/)],
      ]);
    });

    test("names a generated file that fails to write, leaving its error to the plugin failure report", async () => {
      const writeFailure = new Error("generated file write failed");
      vi.mocked(fs.writeFile).mockImplementationOnce((_path, _data, callback) => {
        callback(writeFailure);
      });
      const config = { ...mockConfig, db: {}, resolver: {} };
      const manager = createGenerationManager({
        configServices: defineApplication({ config }),
        config,
        pluginManager: new PluginManager([
          {
            id: "writing-plugin",
            description: "Writes one file",
            onTailorDBReady: async () => ({
              files: [{ path: path.join(tempDir, "generated.txt"), content: "generated" }],
            }),
          },
        ]),
      });

      await expect(manager.generate()).rejects.toMatchObject({
        code: "PLUGIN_GENERATION_FAILED",
      });
      expect(fs.writeFile).toHaveBeenCalledOnce();
      expect(vi.mocked(logger.error).mock.calls).toEqual([
        [expect.stringMatching(/Error writing file .*generated\.txt/)],
        [expect.stringMatching(/Error processing plugin .*writing-plugin.* \(onTailorDBReady\)/)],
        [expect.stringContaining(writeFailure.message)],
      ]);
    });
  });
});
