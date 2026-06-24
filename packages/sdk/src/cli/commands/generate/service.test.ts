import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from "vitest";
import { defineApplication } from "#/cli/services/application";
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

function loadedTailorDBService(namespace: string, typeNames: string[]): TailorDBService {
  const types = Object.fromEntries(
    typeNames.map((typeName) => [typeName, { name: typeName } as TailorDBType]),
  );
  const typeSourceInfo = Object.fromEntries(
    typeNames.map((typeName) => [
      typeName,
      {
        filePath: `${namespace}/${typeName}.ts`,
        exportName: typeName,
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
  } as unknown as TailorDBService;
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

      await manager.generate(false);

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

      await manager.generate(false);

      expect(onTailorDBReady).toHaveBeenCalledWith(
        expect.objectContaining({
          tailordb: [
            expect.objectContaining({
              namespace: "main",
              types: expect.objectContaining({ User: expect.objectContaining({ name: "User" }) }),
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

    test("rejects duplicate TailorDB type names between namespaces", async () => {
      const duplicateApp = applicationWithTailorDBServices(mockConfig, [
        loadedTailorDBService("main", ["User"]),
        loadedTailorDBService("analytics", ["User"]),
      ]);
      const duplicateManager = createGenerationManager({
        application: duplicateApp,
        config: mockConfig,
      });

      await expect(duplicateManager.generate(false)).rejects.toThrow(
        /Duplicate TailorDB type names detected/,
      );
    });

    test("does not exit watch mode for duplicate TailorDB type names", async () => {
      const duplicateApp = applicationWithTailorDBServices(mockConfig, [
        loadedTailorDBService("main", ["User"]),
        loadedTailorDBService("analytics", ["User"]),
      ]);
      const duplicateManager = createGenerationManager({
        application: duplicateApp,
        config: mockConfig,
      });

      await expect(duplicateManager.generate(true)).resolves.not.toThrow();
    });
  });

  describe("watch", () => {
    test("watch method exists", () => {
      const application = defineApplication({ config: mockConfig });
      const manager = createGenerationManager({
        application,
        config: mockConfig,
      });

      expect(typeof manager.watch).toBe("function");
    });

    test("application has tailorDBServices for watch", () => {
      const application = defineApplication({ config: mockConfig });
      const manager = createGenerationManager({
        application,
        config: mockConfig,
      });

      expect(manager.application.tailorDBServices).toBeDefined();
      expect(manager.application.tailorDBServices.length).toBeGreaterThan(0);
      expect(manager.application.tailorDBServices[0]?.namespace).toBe("main");
      expect(manager.application.tailorDBServices[0]?.config.files).toEqual(["src/types/*.ts"]);
    });

    test("application has resolverServices for watch", () => {
      const application = defineApplication({ config: mockConfig });
      const manager = createGenerationManager({
        application,
        config: mockConfig,
      });

      expect(manager.application.resolverServices).toBeDefined();
      expect(manager.application.resolverServices.length).toBeGreaterThan(0);
      expect(manager.application.resolverServices[0]?.namespace).toBe("main");
      expect(manager.application.resolverServices[0]?.config.files).toEqual(["src/resolvers/*.ts"]);
    });
  });
});
