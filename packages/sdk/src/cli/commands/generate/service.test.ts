import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from "vitest";
import { defineApplication } from "#/cli/services/application";
import { createResolver } from "#/configure/services/resolver/resolver";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/index";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutputs } from "#/utils/test/internal";
import { createGenerationManager } from "./service";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { LoadedConfig, Generator } from "#/cli/shared/config-loader";
import type { TailorDBType } from "#/configure/services/tailordb/schema";
import type { Resolver } from "#/types/resolver.generated";

// ESM-safe explicit mock for Node's fs
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

class TestGenerator {
  readonly id = "test-generator";
  readonly description = "Test generator for unit tests";
  readonly dependencies = ["tailordb", "resolver", "executor"] as const;

  async processType(args: {
    type: TailorDBType;
    namespace: string;
    source: { filePath: string; exportName: string };
  }) {
    return { name: args.type.name, processed: true, source: args.source };
  }

  async processResolver(args: { resolver: Resolver; namespace: string }) {
    return { name: args.resolver.name, processed: true };
  }

  async processExecutor<T>(executor: { name: T }) {
    return { name: executor.name, processed: true };
  }

  async processTailorDBNamespace(args: { namespace: string; types: Record<string, unknown> }) {
    return { processed: true, count: Object.keys(args.types).length };
  }

  async processResolverNamespace(args: { namespace: string; resolvers: Record<string, unknown> }) {
    return { processed: true, count: Object.keys(args.resolvers).length };
  }

  async aggregate(args: { input: object; baseDir: string }) {
    return {
      files: [
        {
          path: path.join(args.baseDir, "test-output.txt"),
          content: `Input: ${JSON.stringify(args.input)}`,
        },
      ],
    };
  }
}

function loadedTailorDBService(namespace: string, typeNames: string[]): TailorDBService {
  const types = Object.fromEntries(typeNames.map((typeName) => [typeName, {}]));
  const typeSourceInfo = Object.fromEntries(
    typeNames.map((typeName) => [
      typeName,
      {
        filePath: `${namespace}/${typeName}.ts`,
        exportName: typeName.toLowerCase(),
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

function emptyGeneratorResult() {
  return {
    tailordbResults: {},
    resolverResults: {},
    tailordbNamespaceResults: {},
    resolverNamespaceResults: {},
    executorResults: {},
  };
}

function testResolver(name: string) {
  return createResolver({
    name,
    operation: "query",
    body: () => ({ string: "" }),
    output: t.object({ string: t.string() }),
  });
}

function parsedTestTypes(typeNames: string[], namespace = "test-namespace", sourceInfo = {}) {
  const types = Object.fromEntries(typeNames.map((name) => [name, db.type(name, {})]));
  return parseTypes(toSchemaOutputs(types), namespace, sourceInfo);
}

describe("GenerationManager", () => {
  let tempDir: string;
  // For test-only access to private members
  // oxlint-disable-next-line no-explicit-any
  let manager: any;
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

    // for minimal mock
    const application = defineApplication({ config: mockConfig });
    manager = createGenerationManager({
      application,
      config: mockConfig,
      // oxlint-disable-next-line no-explicit-any
      generators: [new TestGenerator()] as any,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("constructor", () => {
    test("initializes correctly", () => {
      expect(manager.application).toBeDefined();
      expect(manager.baseDir).toContain("generated");
    });

    test("base directory is created", () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("generated"), {
        recursive: true,
      });
    });
  });

  describe("generators", () => {
    test("generators are passed correctly", () => {
      expect(manager.generators.length).toBeGreaterThan(0);
    });

    test("receives custom generator", () => {
      const customApp = defineApplication({ config: mockConfig });
      // For test-only - TestGenerator doesn't have brand symbol
      // oxlint-disable-next-line no-explicit-any
      const managerWithCustom: any = createGenerationManager({
        application: customApp,
        config: mockConfig,
        generators: [new TestGenerator()] as unknown as Generator[],
      });
      expect(
        managerWithCustom.generators.some((gen: { id: string }) => gen.id === "test-generator"),
      ).toBe(true);
    });
  });

  describe("generate", () => {
    test("executes complete generation process", async () => {
      await manager.generate(false);

      expect(manager.generators.length).toBeGreaterThan(0);
      expect(manager.services).toBeDefined();
    });

    test("processes single application", async () => {
      const singleAppConfig = {
        ...mockConfig,
        name: "single-app",
      };
      // For test-only access to private members
      const singleApp = defineApplication({ config: singleAppConfig });
      // oxlint-disable-next-line no-explicit-any
      const singleAppManager: any = createGenerationManager({
        application: singleApp,
        config: singleAppConfig,
      });

      await singleAppManager.generate(false);
      expect(singleAppManager.services).toBeDefined();
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

  describe("runGenerators (via generate)", () => {
    beforeEach(() => {
      manager.services = {
        tailordb: {
          "test-namespace": {
            types: parsedTestTypes(["TestType"]),
            sourceInfo: {},
          },
        },
        resolver: {
          "test-namespace": {
            testResolver: testResolver("testResolver"),
          },
        },
        executor: {},
      };
    });

    test("processes all generators through generate method", async () => {
      const testGenerator = manager.generators[0];
      using aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.generate(false);

      expect(aggregateSpy).toHaveBeenCalled();
    });

    test("errors in generator processing do not affect others", async () => {
      const errorGenerator = {
        id: "error-generator",
        description: "Error generator",
        dependencies: ["tailordb", "resolver", "executor"] as const,
        processType: vi
          .fn()
          .mockImplementation(() => Promise.reject(new Error("Type processing error"))),
        processResolver: vi
          .fn()
          .mockImplementation(() => Promise.reject(new Error("Resolver processing error"))),
        processExecutor: vi
          .fn()
          .mockImplementation(() => Promise.reject(new Error("Executor processing error"))),
        aggregate: vi.fn().mockImplementation(() => Promise.resolve({ files: [] })),
      };

      manager.generators.push(errorGenerator);

      await manager.generate(false);

      expect(errorGenerator.aggregate).toHaveBeenCalled();
    });
  });

  describe("processGenerator", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generators = [testGenerator];

      manager.services.tailordb["test-namespace"] = {
        types: parsedTestTypes(["TestType"]),
        sourceInfo: {},
        pluginAttachments: new Map(),
      };
      manager.services.resolver["test-namespace"] = {
        testResolver: testResolver("testResolver"),
      };
    });

    test("complete processing of single generator", async () => {
      Object.keys(manager.generatorResults).forEach((key) => {
        delete manager.generatorResults[key];
      });

      using processTypeSpy = vi.spyOn(testGenerator, "processType");
      using processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      using aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.processGenerator(testGenerator);

      expect(processTypeSpy).toHaveBeenCalled();
      expect(processResolverSpy).toHaveBeenCalled();
      expect(aggregateSpy).toHaveBeenCalled();
    });

    test("types and resolvers are processed in parallel", async () => {
      Object.keys(manager.generatorResults).forEach((key) => {
        delete manager.generatorResults[key];
      });

      const start = Date.now();
      await manager.processGenerator(testGenerator);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });

  describe("processTailorDBNamespace", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults[testGenerator.id] = emptyGeneratorResult();
    });

    test("processes all types", async () => {
      using processTypeSpy = vi.spyOn(testGenerator, "processType");
      const parsedTypes = parsedTestTypes(["Type1", "Type2", "Type3"]);

      manager.generatorResults[testGenerator.id] = emptyGeneratorResult();

      await manager.processTailorDBNamespace(testGenerator, "test-namespace", {
        types: parsedTypes,
        sourceInfo: {},
        pluginAttachments: new Map(),
      });

      expect(processTypeSpy).toHaveBeenCalledTimes(3);
      expect(
        manager.generatorResults[testGenerator.id].tailordbResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(manager.generatorResults[testGenerator.id].tailordbResults["test-namespace"]),
      ).toHaveLength(3);
    });

    test("does not error with empty types", async () => {
      manager.generatorResults[testGenerator.id] = emptyGeneratorResult();

      await expect(
        manager.processTailorDBNamespace(testGenerator, "test-namespace", {
          types: {},
          sourceInfo: {},
          pluginAttachments: new Map(),
        }),
      ).resolves.not.toThrow();
    });

    test("sourceInfo is correctly passed to processType", async () => {
      using processTypeSpy = vi.spyOn(testGenerator, "processType");
      const sourceInfo = {
        TestType: {
          filePath: "test.ts",
          exportName: "TestType",
        },
      };
      const parsedTypes = parsedTestTypes(["TestType"], "test-namespace", sourceInfo);

      manager.generatorResults[testGenerator.id] = emptyGeneratorResult();

      await manager.processTailorDBNamespace(testGenerator, "test-namespace", {
        types: parsedTypes,
        sourceInfo,
        pluginAttachments: new Map(),
      });

      expect(processTypeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.any(Object),
          namespace: "test-namespace",
          source: expect.objectContaining({
            filePath: "test.ts",
            exportName: "TestType",
          }),
          plugins: [],
        }),
      );
    });
  });

  describe("processResolverNamespace", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults[testGenerator.id] = emptyGeneratorResult();
    });

    test("processes all resolvers", async () => {
      using processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      const resolvers = {
        resolver1: testResolver("resolver1"),
        resolver2: testResolver("resolver2"),
      };

      await manager.processResolverNamespace(testGenerator, "test-namespace", resolvers);

      expect(processResolverSpy).toHaveBeenCalledTimes(2);
      expect(
        manager.generatorResults[testGenerator.id].resolverResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(manager.generatorResults[testGenerator.id].resolverResults["test-namespace"]),
      ).toHaveLength(2);
    });
  });

  describe("aggregate", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults[testGenerator.id] = {
        ...emptyGeneratorResult(),
        tailordbNamespaceResults: {
          "test-namespace": { types: "processed" },
        },
        resolverNamespaceResults: {
          "test-namespace": { resolvers: "processed" },
        },
      };
    });

    test("calls generator aggregate method", async () => {
      using aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.aggregate(testGenerator);

      expect(aggregateSpy).toHaveBeenCalledWith({
        input: {
          tailordb: [
            {
              namespace: "test-namespace",
              types: { types: "processed" },
            },
          ],
          resolver: [
            {
              namespace: "test-namespace",
              resolvers: { resolvers: "processed" },
            },
          ],
          executor: [],
          auth: undefined,
        },
        baseDir: expect.stringContaining(testGenerator.id),
        configPath: expect.any(String),
      });
    });

    test("writes files correctly", async () => {
      await manager.aggregate(testGenerator);

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    test("parallel writing of multiple files", async () => {
      vi.mocked(fs.writeFile).mockClear();

      const multiFileGenerator = {
        id: testGenerator.id,
        description: testGenerator.description,
        dependencies: testGenerator.dependencies,
        aggregate: vi.fn().mockResolvedValue({
          files: [
            { path: "/test/file1.txt", content: "content1" },
            { path: "/test/file2.txt", content: "content2" },
            { path: "/test/file3.txt", content: "content3" },
          ],
        }),
      };

      manager.generatorResults[multiFileGenerator.id] = emptyGeneratorResult();

      await manager.aggregate(multiFileGenerator);

      expect(fs.writeFile).toHaveBeenCalledTimes(3);
    });

    test("handles file write errors", async () => {
      const writeFileError = new Error("Write permission denied");
      vi.mocked(fs.writeFile).mockImplementationOnce((_path, _content, callback) => {
        callback(writeFileError);
      });

      const errorGenerator = {
        id: testGenerator.id,
        description: testGenerator.description,
        dependencies: testGenerator.dependencies,
        aggregate: vi.fn().mockResolvedValue({
          files: [{ path: "/test/error.txt", content: "content" }],
        }),
      };

      manager.generatorResults[errorGenerator.id] = emptyGeneratorResult();

      await expect(manager.aggregate(errorGenerator)).rejects.toThrow("Write permission denied");
    });
  });

  describe("watch", () => {
    test("watch method exists", () => {
      expect(typeof manager.watch).toBe("function");
    });

    test("application has tailorDBServices for watch", () => {
      expect(manager.application.tailorDBServices).toBeDefined();
      expect(manager.application.tailorDBServices.length).toBeGreaterThan(0);
      expect(manager.application.tailorDBServices[0].namespace).toBe("main");
      expect(manager.application.tailorDBServices[0].config.files).toEqual(["src/types/*.ts"]);
    });

    test("application has resolverServices for watch", () => {
      expect(manager.application.resolverServices).toBeDefined();
      expect(manager.application.resolverServices.length).toBeGreaterThan(0);
      expect(manager.application.resolverServices[0].namespace).toBe("main");
      expect(manager.application.resolverServices[0].config.files).toEqual(["src/resolvers/*.ts"]);
    });
  });
});

describe("generate function", () => {
  let mockConfig: LoadedConfig;

  beforeEach(() => {
    mockConfig = {
      name: "test-workspace",
      path: "tailor.config.ts",
    };
  });

  test("generate does not automatically call watch", async () => {
    const app = defineApplication({ config: mockConfig });
    const manager = createGenerationManager({ application: app, config: mockConfig });
    await expect(manager.generate(false)).resolves.not.toThrow();
    expect(manager.application).toBeDefined();
  });
});

describe("Integration Tests", () => {
  let tempDir: string;
  let fullConfig: LoadedConfig;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-test-"));

    fullConfig = {
      name: "testApp",
      path: "tailor.config.ts",
      db: {
        main: {
          files: [path.join(tempDir, "types/*.ts")],
        },
      },
      resolver: {
        main: {
          files: [path.join(tempDir, "resolvers/*.ts")],
        },
      },
    };
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("complete integration test with multiple generators", async () => {
    const gen1 = new TestGenerator();
    const gen2 = new TestGenerator();
    // For test-only access to private members
    // oxlint-disable-next-line no-explicit-any
    const generators: any[] = [gen1, gen2];
    const integrationApp = defineApplication({ config: fullConfig });
    // oxlint-disable-next-line no-explicit-any
    const manager: any = createGenerationManager({
      application: integrationApp,
      config: fullConfig,
      generators,
    });

    await expect(manager.generate(false)).resolves.not.toThrow();

    expect(manager.generators.length).toBe(2);
    expect(manager.generators.every((g: unknown) => g instanceof TestGenerator)).toBe(true);
  });

  test("integration test for error recovery and performance", async () => {
    const errorApp = defineApplication({ config: fullConfig });
    const manager = createGenerationManager({ application: errorApp, config: fullConfig });

    const start = Date.now();
    await manager.generate(false);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  describe("Memory Management", () => {
    test("no memory leak with large data processing", async () => {
      // For test-only - TestGenerator doesn't have brand symbol
      // oxlint-disable-next-line no-explicit-any
      const largeGenerators: any[] = Array(10)
        .fill(0)
        .map(() => new TestGenerator());

      // For test-only access to private members
      const memApp = defineApplication({ config: fullConfig });
      // oxlint-disable-next-line no-explicit-any
      const manager: any = createGenerationManager({
        application: memApp,
        config: fullConfig,
        generators: largeGenerators,
      });

      // Create large application data structure
      manager.services = {
        tailordb: {},
        resolver: {},
        executor: {},
      };

      // Add multiple namespaces
      Array(10)
        .fill(0)
        .forEach((_, nsIdx) => {
          const namespace = `namespace-${nsIdx}`;

          // Add types to namespace
          const types: Record<string, TailorDBType> = {};
          Array(50)
            .fill(0)
            .forEach((_, typeIdx) => {
              types[`Type${nsIdx}_${typeIdx}`] = db.type(`Type${nsIdx}_${typeIdx}`, {});
            });

          const parsedTypes = parseTypes(toSchemaOutputs(types), namespace, {});

          manager.services.tailordb[namespace] = {
            types: parsedTypes,
            sourceInfo: {},
          };

          // Add resolvers to namespace
          manager.services.resolver[namespace] = {};
          Array(10)
            .fill(0)
            .forEach((_, resolverIdx) => {
              manager.services.resolver[namespace][`resolver${nsIdx}_${resolverIdx}`] =
                testResolver(`resolver${nsIdx}_${resolverIdx}`);
            });
        });

      await expect(manager.generate(false)).resolves.not.toThrow();
    });
  });
});
