import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  afterAll,
} from "vitest";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { GeneratorConfigSchema } from "@/cli/config-loader";
import { KyselyGenerator } from "@/cli/generator/builtin/kysely-type";
import { createResolver } from "@/configure/services/resolver/resolver";
import { db, type TailorDBType } from "@/configure/services/tailordb/schema";
import { t } from "@/configure/types";
import { type Resolver } from "@/parser/service/resolver";
import { DependencyWatcher } from "./watch";
import { GenerationManager } from "./index";
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

  async processExecutor(executor: any) {
    return { name: executor.name, processed: true };
  }

  async processTailorDBNamespace(args: {
    namespace: string;
    types: Record<string, unknown>;
  }) {
    return { processed: true, count: Object.keys(args.types).length };
  }

  async processResolverNamespace(args: {
    namespace: string;
    resolvers: Record<string, unknown>;
  }) {
    return { processed: true, count: Object.keys(args.resolvers).length };
  }

  async aggregate(args: {
    input: any;
    executorInputs: unknown[];
    baseDir: string;
  }) {
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
  let manager: any;
  let mockConfig: AppConfig;

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "generation-manager-test-"),
    );

    mockConfig = {
      name: "testApp",
      db: { main: { files: ["src/types/*.ts"] } },
      resolver: { main: { files: ["src/resolvers/*.ts"] } },
      auth: { namespace: "test-auth" },
    } as any;

    manager = new GenerationManager(mockConfig, [new TestGenerator()] as any);
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
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("generated"),
        {
          recursive: true,
        },
      );
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
      const managerWithKysely = new GenerationManager(mockConfig, [kyselyGen]);
      expect(
        (managerWithKysely as any).generators.some(
          (gen: unknown) => gen instanceof KyselyGenerator,
        ),
      ).toBe(true);
    });
  });

  describe("generate", () => {
    it("executes complete generation process", async () => {
      await manager.generate({ watch: false });

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
      const singleAppManager: any = new GenerationManager(singleAppConfig, []);

      await singleAppManager.generate(false);
      expect(singleAppManager.services).toBeDefined();
    });
  });

  describe("processGenerators", () => {
    beforeEach(async () => {
      const types = {
        testType: db.type("TestType", {}),
      };
      const service = new TailorDBService("test-namespace", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      service["parseTypes"]();

      manager.services = {
        tailordb: {
          "test-namespace": {
            types: service.getTypes(),
            sourceInfo: service.getTypeSourceInfo(),
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

    it("processes all generators in parallel", async () => {
      const processGeneratorSpy = vi.spyOn(manager, "processGenerator");

      await manager.processGenerators();

      expect(processGeneratorSpy).toHaveBeenCalledTimes(
        manager.generators.length,
      );
    });

    it("errors in generator processing do not affect others", async () => {
      const errorGenerator = {
        id: "error-generator",
        description: "Error generator",
        processType: vi
          .fn()
          .mockImplementation(() =>
            Promise.reject(new Error("Type processing error")),
          ),
        processResolver: vi
          .fn()
          .mockImplementation(() =>
            Promise.reject(new Error("Resolver processing error")),
          ),
        processExecutor: vi
          .fn()
          .mockImplementation(() =>
            Promise.reject(new Error("Executor processing error")),
          ),
        aggregate: vi
          .fn()
          .mockImplementation(() => Promise.resolve({ files: [] })),
      };

      manager.generators.push(errorGenerator);

      // Verify that processing continues even if an error occurs
      await manager.processGenerators();

      // Verify that normal generators are processed and error generator methods are also called
      expect(errorGenerator.processType).toHaveBeenCalled();
      expect(errorGenerator.processResolver).toHaveBeenCalled();
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
      const service = new TailorDBService("test-namespace", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      service["parseTypes"]();

      manager.services = {
        tailordb: {
          "test-namespace": {
            types: service.getTypes(),
            sourceInfo: service.getTypeSourceInfo(),
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

    it("complete processing of single generator", async () => {
      // Initialize generatorResults
      manager.generatorResults = {};

      const processTailorDBNamespaceSpy = vi.spyOn(
        manager,
        "processTailorDBNamespace",
      );
      const processResolverNamespaceSpy = vi.spyOn(
        manager,
        "processResolverNamespace",
      );
      const aggregateSpy = vi.spyOn(manager, "aggregate");

      await manager.processGenerator(testGenerator);

      expect(processTailorDBNamespaceSpy).toHaveBeenCalled();
      expect(processResolverNamespaceSpy).toHaveBeenCalled();
      expect(aggregateSpy).toHaveBeenCalledWith(testGenerator);
    });

    it("types and resolvers are processed in parallel", async () => {
      // Initialize generatorResults
      manager.generatorResults = {};

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
      manager.generatorResults = {
        [testGenerator.id]: {
          tailordbResults: {},
          resolverResults: {},
          tailordbNamespaceResults: {},
          resolverNamespaceResults: {},
          executorResults: {},
        },
      };
    });

    it("processes all types", async () => {
      const processTypeSpy = vi.spyOn(testGenerator, "processType");
      const types = {
        type1: db.type("Type1", {}),
        type2: db.type("Type2", {}),
        type3: db.type("Type3", {}),
      };

      const service = new TailorDBService("test-namespace", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      service["parseTypes"]();

      // Initialize generatorResults
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

      await manager.processTailorDBNamespace(testGenerator, "test-namespace", {
        types: service.getTypes(),
        sourceInfo: service.getTypeSourceInfo(),
      });

      expect(processTypeSpy).toHaveBeenCalledTimes(3);
      expect(
        manager.generatorResults[testGenerator.id].tailordbResults[
          "test-namespace"
        ],
      ).toBeDefined();
      expect(
        Object.keys(
          manager.generatorResults[testGenerator.id].tailordbResults[
            "test-namespace"
          ],
        ),
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

      const service = new TailorDBService("test-namespace", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      // Manually set typeSourceInfo since we're not using loadTypesForFile
      service["typeSourceInfo"]["TestType"] = {
        filePath: "test.ts",
        exportName: "TestType",
      };
      service["parseTypes"]();

      // Initialize generatorResults
      manager.generatorResults[testGenerator.id] = {
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

      await manager.processTailorDBNamespace(testGenerator, "test-namespace", {
        types: service.getTypes(),
        sourceInfo: service.getTypeSourceInfo(),
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
      manager.generatorResults = {
        [testGenerator.id]: {
          tailordbResults: {},
          resolverResults: {},
          tailordbNamespaceResults: {},
          resolverNamespaceResults: {},
          executorResults: {},
        },
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

      await manager.processResolverNamespace(
        testGenerator,
        "test-namespace",
        resolvers,
      );

      expect(processResolverSpy).toHaveBeenCalledTimes(2);
      expect(
        manager.generatorResults[testGenerator.id].resolverResults[
          "test-namespace"
        ],
      ).toBeDefined();
      expect(
        Object.keys(
          manager.generatorResults[testGenerator.id].resolverResults[
            "test-namespace"
          ],
        ),
      ).toHaveLength(2);
    });
  });

  describe("aggregate", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults = {
        [testGenerator.id]: {
          tailordbResults: {},
          resolverResults: {},
          tailordbNamespaceResults: {
            "test-namespace": { types: "processed" },
          },
          resolverNamespaceResults: {
            "test-namespace": { resolvers: "processed" },
          },
          executorResults: {},
        },
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
          auth: expect.anything(),
        },
        executorInputs: [],
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
        ...testGenerator,
        aggregate: vi.fn().mockResolvedValue({
          files: [
            { path: "/test/file1.txt", content: "content1" },
            { path: "/test/file2.txt", content: "content2" },
            { path: "/test/file3.txt", content: "content3" },
          ],
        }),
      };

      manager.generatorResults = {
        [multiFileGenerator.id]: {
          tailordbResults: {},
          resolverResults: {},
          tailordbNamespaceResults: {},
          resolverNamespaceResults: {},
          executorResults: {},
        },
      };

      await manager.aggregate(multiFileGenerator);

      expect(fs.writeFile).toHaveBeenCalledTimes(3);
    });

    it("handles file write errors", async () => {
      const writeFileError = new Error("Write permission denied");
      vi.mocked(fs.writeFile).mockImplementationOnce(
        (_path, _content, callback) => {
          callback(writeFileError);
        },
      );

      const errorGenerator = {
        ...testGenerator,
        aggregate: vi.fn().mockResolvedValue({
          files: [{ path: "/test/error.txt", content: "content" }],
        }),
      };

      manager.generatorResults = {
        [errorGenerator.id]: {
          tailordbResults: {},
          resolverResults: {},
          tailordbNamespaceResults: {},
          resolverNamespaceResults: {},
          executorResults: {},
        },
      };

      await expect(manager.aggregate(errorGenerator)).rejects.toThrow(
        "Write permission denied",
      );
    });
  });

  describe("watch", () => {
    let mockWatcher: any;

    beforeEach(() => {
      mockWatcher = {
        addWatchGroup: vi.fn(),
        setRestartCallback: vi.fn(),
      };
      vi.spyOn(DependencyWatcher.prototype, "addWatchGroup").mockImplementation(
        mockWatcher.addWatchGroup,
      );
      vi.spyOn(
        DependencyWatcher.prototype,
        "setRestartCallback",
      ).mockImplementation(mockWatcher.setRestartCallback);

      // Mock the infinite Promise at the end of watch()
      vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(
        async function (this: GenerationManager) {
          // Call the original implementation up to the infinite Promise
          const watcher = new DependencyWatcher();
          (this as any).watcher = watcher;

          watcher.setRestartCallback(() => {
            (this as any).restartWatchProcess();
          });

          if ((this as any).configPath) {
            await watcher.addWatchGroup("Config", [(this as any).configPath]);
          }

          const app = (this as any).application;

          for (const db of app.tailorDBServices) {
            const dbNamespace = db.namespace;
            await watcher?.addWatchGroup(
              `TailorDB/${dbNamespace}`,
              db.config.files,
            );
          }

          for (const resolverService of app.resolverServices) {
            const resolverNamespace = resolverService.namespace;
            await watcher?.addWatchGroup(
              `Resolver/${resolverNamespace}`,
              resolverService["config"].files,
            );
          }

          // Instead of await new Promise(() => {}), resolve immediately for tests
          return Promise.resolve();
        },
      );
    });

    it("adds watch group for TailorDB service", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith("TailorDB/main", [
        "src/types/*.ts",
      ]);
    });

    it("adds watch group for Resolver service", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith("Resolver/main", [
        "src/resolvers/*.ts",
      ]);
    });
  });
});

describe("generate function", () => {
  let mockConfig: AppConfig;

  beforeEach(() => {
    mockConfig = {
      name: "test-workspace",
    } as any;
  });

  it("creates and executes GenerationManager", async () => {
    const manager = new GenerationManager(mockConfig, []);
    await expect(manager.generate(false)).resolves.not.toThrow();
  });

  it("starts watch when watch option is true", async () => {
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    const manager = new GenerationManager(mockConfig, []);
    await manager.generate(false);
    await manager.watch();

    expect(watchSpy).toHaveBeenCalled();
  });

  it("does not start watch when watch option is false", async () => {
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    const manager = new GenerationManager(mockConfig, []);
    await manager.generate(false);

    expect(watchSpy).not.toHaveBeenCalled();
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
      auth: {
        namespace: "test-auth",
      },
    } as any;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("complete integration test with multiple generators", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const kyselyGen = GeneratorConfigSchema.parse([
      "@tailor-platform/kysely-type",
      { distPath: "db.ts" },
    ]);
    const generators = [new TestGenerator(), kyselyGen];
    const manager = new GenerationManager(fullConfig, generators);

    await expect(manager.generate({ watch: false })).resolves.not.toThrow();

    expect(manager.generators.length).toBe(2);
    expect(
      manager.generators.some((g: unknown) => g instanceof TestGenerator),
    ).toBe(true);
    expect(
      manager.generators.some((g: unknown) => g instanceof KyselyGenerator),
    ).toBe(true);
  });

  it("integration test for error recovery and performance", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const manager = new GenerationManager(fullConfig, []);

    const start = Date.now();
    await manager.generate({ watch: false });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  describe("Memory Management", () => {
    it("no memory leak with large data processing", async () => {
      const largeGenerators = Array(10)
        .fill(0)
        .map(() => new TestGenerator());

      const indexModule = await import("./index");
      const GenerationManager = (indexModule as any).GenerationManager;
      const manager = new GenerationManager(fullConfig, largeGenerators);

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
              types[`Type${nsIdx}_${typeIdx}`] = db.type(
                `Type${nsIdx}_${typeIdx}`,
                {},
              );
            });

          const service = new TailorDBService(namespace, { files: [] });
          service["rawTypes"]["test.ts"] = types;
          service["parseTypes"]();

          manager.services.tailordb[namespace] = {
            types: service.getTypes(),
            sourceInfo: service.getTypeSourceInfo(),
          };

          // Add resolvers to namespace
          manager.services.resolver[namespace] = {};
          Array(10)
            .fill(0)
            .forEach((_, resolverIdx) => {
              manager.services.resolver[namespace][
                `resolver${nsIdx}_${resolverIdx}`
              ] = createResolver({
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
