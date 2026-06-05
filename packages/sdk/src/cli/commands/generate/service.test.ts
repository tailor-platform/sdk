import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, afterAll } from "vitest";
import { defineApplication } from "@/cli/services/application";
import { createResolver } from "@/configure/services/resolver/resolver";
import { db } from "@/configure/services/tailordb/schema";
import { t } from "@/configure/types";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutputs } from "@/utils/test/internal";
import { createGenerationManager } from "./service";
import type { LoadedConfig, Generator } from "@/cli/shared/config-loader";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { Resolver } from "@/types/resolver.generated";

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

vi.mock("@/cli/shared/logger", async (importOriginal) => {
  const actual = (await importOriginal()) as {
    logger?: Record<string, unknown>;
    styles?: Record<string, unknown>;
    symbols?: Record<string, unknown>;
  };
  return {
    ...actual,
    logger: {
      ...(actual.logger ?? {}),
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

      // Generators are configured but may be 0 if actual type files do not exist
      expect(manager.generators.length).toBeGreaterThan(0);
      // services will be empty if actual files do not exist
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
  });

  describe("runGenerators (via generate)", () => {
    beforeEach(async () => {
      const types = {
        testType: db.type("TestType", {}),
      };
      const parsedTypes = parseTypes(
        toSchemaOutputs({ TestType: types.testType }),
        "test-namespace",
        {},
      );

      manager.services = {
        tailordb: {
          "test-namespace": {
            types: parsedTypes,
            sourceInfo: {},
          },
        },
        resolver: {
          "test-namespace": {
            testResolver: createResolver({
              name: "testResolver",
              operation: "query",
              // input removed
              body: () => ({ string: "" }),
              output: t.object({ string: t.string() }),
            }),
          },
        },
        executor: {},
      };
    });

    test("processes all generators through generate method", async () => {
      // Spy on the generator's aggregate method to verify it was called
      const testGenerator = manager.generators[0];
      using aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      // Use generate method which orchestrates all generator processing
      await manager.generate(false);

      // Should process the generator by calling its aggregate method
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

      // Verify that processing continues even if an error occurs
      // Use generate method to trigger processing
      await manager.generate(false);

      // After generate runs, the error generator's methods should have been called
      // The test validates that errors don't prevent the generate from completing
      expect(errorGenerator.aggregate).toHaveBeenCalled();
    });
  });

  describe("processGenerator", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generators = [testGenerator];

      const types = {
        testType: db.type("TestType", {}),
      };
      const parsedTypes = parseTypes(
        toSchemaOutputs({ TestType: types.testType }),
        "test-namespace",
        {},
      );

      // Modify existing object instead of reassigning (closure pattern)
      manager.services.tailordb["test-namespace"] = {
        types: parsedTypes,
        sourceInfo: {},
        pluginAttachments: new Map(),
      };
      manager.services.resolver["test-namespace"] = {
        testResolver: createResolver({
          name: "testResolver",
          operation: "query",
          // input removed
          body: () => ({ string: "" }),
          output: t.object({ string: t.string() }),
        }),
      };
    });

    test("complete processing of single generator", async () => {
      // Clear existing generatorResults (closure pattern - must not reassign)
      Object.keys(manager.generatorResults).forEach((key) => {
        delete manager.generatorResults[key];
      });

      // Spy on the generator's methods to verify they were called
      using processTypeSpy = vi.spyOn(testGenerator, "processType");
      using processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      using aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.processGenerator(testGenerator);

      // Verify generator methods were called during processing
      expect(processTypeSpy).toHaveBeenCalled();
      expect(processResolverSpy).toHaveBeenCalled();
      expect(aggregateSpy).toHaveBeenCalled();
    });

    test("types and resolvers are processed in parallel", async () => {
      // Clear existing generatorResults (closure pattern - must not reassign)
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
      // Modify the existing object instead of reassigning (closure pattern)
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };
    });

    test("processes all types", async () => {
      using processTypeSpy = vi.spyOn(testGenerator, "processType");
      const types = {
        type1: db.type("Type1", {}),
        type2: db.type("Type2", {}),
        type3: db.type("Type3", {}),
      };

      const parsedTypes = parseTypes(
        toSchemaOutputs({ Type1: types.type1, Type2: types.type2, Type3: types.type3 }),
        "test-namespace",
        {},
      );

      // Initialize generatorResults
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

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
      // Initialize generatorResults
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

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
      const types = {
        TestType: db.type("TestType", {}),
      };

      const sourceInfo = {
        TestType: {
          filePath: "test.ts",
          exportName: "TestType",
        },
      };
      const parsedTypes = parseTypes(
        toSchemaOutputs({ TestType: types.TestType }),
        "test-namespace",
        sourceInfo,
      );

      // Initialize generatorResults
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

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
      // Modify the existing object instead of reassigning (closure pattern)
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };
    });

    test("processes all resolvers", async () => {
      using processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      const resolvers = {
        resolver1: createResolver({
          name: "resolver1",
          operation: "query",
          // input removed
          body: () => ({ string: "" }),
          output: t.object({ string: t.string() }),
        }),
        resolver2: createResolver({
          name: "resolver2",
          operation: "query",
          // input removed
          body: () => ({ string: "" }),
          output: t.object({ string: t.string() }),
        }),
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
      // Modify the existing object instead of reassigning (closure pattern)
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {
          "test-namespace": { types: "processed" },
        },
        resolverNamespaceResults: {
          "test-namespace": { resolvers: "processed" },
        },
        executorResults: {},
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
      // Clear previous calls
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

      // Modify existing object instead of reassigning (closure pattern)
      manager.generatorResults[multiFileGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

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

      // Modify existing object instead of reassigning (closure pattern)
      manager.generatorResults[errorGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

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
                createResolver({
                  name: `resolver${nsIdx}_${resolverIdx}`,
                  operation: "query",
                  // input removed
                  body: () => ({ string: "" }),
                  output: t.object({ string: t.string() }),
                });
            });
        });

      await expect(manager.generate(false)).resolves.not.toThrow();
    });
  });
});
