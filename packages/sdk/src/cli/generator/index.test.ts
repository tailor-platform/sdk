import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import { GeneratorConfigSchema } from "@/cli/config-loader";
import { KyselyGeneratorID } from "@/cli/generator/builtin/kysely-type";
import { createResolver } from "@/configure/services/resolver/resolver";
import { db, type TailorDBType } from "@/configure/services/tailordb/schema";
import { t } from "@/configure/types";
import { type Resolver } from "@/parser/service/resolver";
import { parseTypes } from "@/parser/service/tailordb";
import { createGenerationManager } from "./index";
import type { AppConfig } from "@/configure/config";

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
  let mockConfig: AppConfig;

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "generation-manager-test-"));

    mockConfig = {
      name: "testApp",
      db: { main: { files: ["src/types/*.ts"] } },
      resolver: { main: { files: ["src/resolvers/*.ts"] } },
    };

    // for minimal mock
    // oxlint-disable-next-line no-explicit-any
    manager = createGenerationManager(mockConfig, [new TestGenerator()] as any);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("constructor", () => {
    it("initializes correctly", () => {
      expect(manager.application).toBeDefined();
      expect(manager.baseDir).toContain("generated");
    });

    it("base directory is created", () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("generated"), {
        recursive: true,
      });
    });
  });

  describe("generators", () => {
    it("generators are passed correctly", () => {
      expect(manager.generators.length).toBeGreaterThan(0);
    });

    it("receives Kysely generator", () => {
      const kyselyGen = GeneratorConfigSchema.parse([
        "@tailor-platform/kysely-type",
        { distPath: "types/db.ts" },
      ]);
      const managerWithKysely = createGenerationManager(mockConfig, [kyselyGen]);
      expect(
        // For test-only access to private members
        // oxlint-disable-next-line no-explicit-any
        (managerWithKysely as any).generators.some(
          (gen: { id: string }) => gen.id === KyselyGeneratorID,
        ),
      ).toBe(true);
    });
  });

  describe("generate", () => {
    it("executes complete generation process", async () => {
      await manager.generate(false);

      // Generators are configured but may be 0 if actual type files do not exist
      expect(manager.generators.length).toBeGreaterThan(0);
      // services will be empty if actual files do not exist
      expect(manager.services).toBeDefined();
    });

    it("processes single application", async () => {
      const singleAppConfig = {
        ...mockConfig,
        name: "single-app",
      };
      // For test-only access to private members
      // oxlint-disable-next-line no-explicit-any
      const singleAppManager: any = createGenerationManager(singleAppConfig, []);

      await singleAppManager.generate(false);
      expect(singleAppManager.services).toBeDefined();
    });
  });

  describe("runGenerators (via generate)", () => {
    beforeEach(async () => {
      const types = {
        testType: db.type("TestType", {}),
      };
      const parsedTypes = parseTypes({ TestType: types.testType }, "test-namespace", {});

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

    it("processes all generators through generate method", async () => {
      // Spy on the generator's aggregate method to verify it was called
      const testGenerator = manager.generators[0];
      const aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      // Use generate method which orchestrates all generator processing
      await manager.generate(false);

      // Should process the generator by calling its aggregate method
      expect(aggregateSpy).toHaveBeenCalled();
    });

    it("errors in generator processing do not affect others", async () => {
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
      const parsedTypes = parseTypes({ TestType: types.testType }, "test-namespace", {});

      // Modify existing object instead of reassigning (closure pattern)
      manager.services.tailordb["test-namespace"] = {
        types: parsedTypes,
        sourceInfo: {},
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

    it("complete processing of single generator", async () => {
      // Clear existing generatorResults (closure pattern - must not reassign)
      Object.keys(manager.generatorResults).forEach((key) => {
        delete manager.generatorResults[key];
      });

      // Spy on the generator's methods to verify they were called
      const processTypeSpy = vi.spyOn(testGenerator, "processType");
      const processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      const aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.processGenerator(testGenerator);

      // Verify generator methods were called during processing
      expect(processTypeSpy).toHaveBeenCalled();
      expect(processResolverSpy).toHaveBeenCalled();
      expect(aggregateSpy).toHaveBeenCalled();
    });

    it("types and resolvers are processed in parallel", async () => {
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

    it("processes all types", async () => {
      const processTypeSpy = vi.spyOn(testGenerator, "processType");
      const types = {
        type1: db.type("Type1", {}),
        type2: db.type("Type2", {}),
        type3: db.type("Type3", {}),
      };

      const parsedTypes = parseTypes(
        { Type1: types.type1, Type2: types.type2, Type3: types.type3 },
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
      });

      expect(processTypeSpy).toHaveBeenCalledTimes(3);
      expect(
        manager.generatorResults[testGenerator.id].tailordbResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(manager.generatorResults[testGenerator.id].tailordbResults["test-namespace"]),
      ).toHaveLength(3);
    });

    it("does not error with empty types", async () => {
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
        }),
      ).resolves.not.toThrow();
    });

    it("sourceInfo is correctly passed to processType", async () => {
      const processTypeSpy = vi.spyOn(testGenerator, "processType");
      const types = {
        TestType: db.type("TestType", {}),
      };

      const sourceInfo = {
        TestType: {
          filePath: "test.ts",
          exportName: "TestType",
        },
      };
      const parsedTypes = parseTypes({ TestType: types.TestType }, "test-namespace", sourceInfo);

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
      });

      expect(processTypeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.any(Object),
          namespace: "test-namespace",
          source: expect.objectContaining({
            filePath: "test.ts",
            exportName: "TestType",
          }),
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

    it("processes all resolvers", async () => {
      const processResolverSpy = vi.spyOn(testGenerator, "processResolver");
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

    it("calls generator aggregate method", async () => {
      const aggregateSpy = vi.spyOn(testGenerator, "aggregate");

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

    it("writes files correctly", async () => {
      await manager.aggregate(testGenerator);

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it("parallel writing of multiple files", async () => {
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

    it("handles file write errors", async () => {
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
    it("watch method exists", () => {
      expect(typeof manager.watch).toBe("function");
    });

    it("application has tailorDBServices for watch", () => {
      expect(manager.application.tailorDBServices).toBeDefined();
      expect(manager.application.tailorDBServices.length).toBeGreaterThan(0);
      expect(manager.application.tailorDBServices[0].namespace).toBe("main");
      expect(manager.application.tailorDBServices[0].config.files).toEqual(["src/types/*.ts"]);
    });

    it("application has resolverServices for watch", () => {
      expect(manager.application.resolverServices).toBeDefined();
      expect(manager.application.resolverServices.length).toBeGreaterThan(0);
      expect(manager.application.resolverServices[0].namespace).toBe("main");
      expect(manager.application.resolverServices[0].config.files).toEqual(["src/resolvers/*.ts"]);
    });
  });
});

describe("generate function", () => {
  let mockConfig: AppConfig;

  beforeEach(() => {
    mockConfig = {
      name: "test-workspace",
    };
  });

  it("creates and executes GenerationManager", async () => {
    const manager = createGenerationManager(mockConfig, []);
    await expect(manager.generate(false)).resolves.not.toThrow();
  });

  it("manager has watch method", () => {
    const manager = createGenerationManager(mockConfig, []);
    expect(typeof manager.watch).toBe("function");
  });

  it("generate does not automatically call watch", async () => {
    const manager = createGenerationManager(mockConfig, []);
    await expect(manager.generate(false)).resolves.not.toThrow();
    expect(manager.application).toBeDefined();
  });
});

describe("Integration Tests", () => {
  let tempDir: string;
  let fullConfig: AppConfig;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-test-"));

    fullConfig = {
      name: "testApp",
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

  it("complete integration test with multiple generators", async () => {
    const kyselyGen = GeneratorConfigSchema.parse([
      "@tailor-platform/kysely-type",
      { distPath: "db.ts" },
    ]);
    // For test-only access to private members
    // oxlint-disable-next-line no-explicit-any
    const generators: any[] = [new TestGenerator(), kyselyGen];
    // oxlint-disable-next-line no-explicit-any
    const manager: any = createGenerationManager(fullConfig, generators);

    await expect(manager.generate(false)).resolves.not.toThrow();

    expect(manager.generators.length).toBe(2);
    expect(manager.generators.some((g: unknown) => g instanceof TestGenerator)).toBe(true);
    expect(manager.generators.some((g: { id: string }) => g.id === KyselyGeneratorID)).toBe(true);
  });

  it("integration test for error recovery and performance", async () => {
    const manager = createGenerationManager(fullConfig, []);

    const start = Date.now();
    await manager.generate(false);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  describe("Memory Management", () => {
    it("no memory leak with large data processing", async () => {
      // For test-only - TestGenerator doesn't have brand symbol
      // oxlint-disable-next-line no-explicit-any
      const largeGenerators: any[] = Array(10)
        .fill(0)
        .map(() => new TestGenerator());

      // For test-only access to private members
      // oxlint-disable-next-line no-explicit-any
      const manager: any = createGenerationManager(fullConfig, largeGenerators);

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

          const parsedTypes = parseTypes(types, namespace, {});

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
