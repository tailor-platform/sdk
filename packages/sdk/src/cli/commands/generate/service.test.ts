import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from "vitest";
import { defineApplication } from "#/cli/services/application";
import { errorToJson } from "#/cli/shared/error-json";
import { CLIError, isCLIError } from "#/cli/shared/errors";
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
  const actual = (await importOriginal()) as {
    logger?: Record<string, unknown>;
    styles?: Record<string, unknown>;
    symbols?: Record<string, unknown>;
  };
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
        application,
        config: mockConfig,
      });

      expect(manager.application).toBe(application);
      expect(manager.baseDir).toContain("generated");
      expect(manager.services).toEqual({ tailordb: {}, resolver: {}, executor: {} });
      expect("generators" in manager).toBe(false);
      expect("generatorResults" in manager).toBe(false);
      expect("processGenerator" in manager).toBe(false);
    });

    test("creates base directory", () => {
      const application = defineApplication({ config: mockConfig });
      createGenerationManager({
        application,
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
        application,
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
        application,
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
          application: defineApplication({ config }),
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
        expect(errorToJson(failure)).toMatchObject({
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

    test("rejects duplicate TailorDB table names between namespaces", async () => {
      const duplicateApp = applicationWithTailorDBServices(mockConfig, [
        loadedTailorDBService("main", ["User"]),
        loadedTailorDBService("analytics", ["User"]),
      ]);
      const duplicateManager = createGenerationManager({
        application: duplicateApp,
        config: mockConfig,
      });

      await expect(duplicateManager.generate()).rejects.toThrow(
        /Duplicate TailorDB table names detected/,
      );
    });
  });
});
