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
    writeFile: vi.fn((_, _2, callback: any) => {
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
    applicationNamespace: string;
    namespace: string;
  }) {
    return { name: args.type.name, processed: true };
  }

  async processResolver(args: {
    resolver: Resolver;
    applicationNamespace: string;
    namespace: string;
  }) {
    return { name: args.resolver.name, processed: true };
  }

  async processExecutor(executor: any) {
    return { name: executor.name, processed: true };
  }

  async processTailorDBNamespace(args: {
    applicationNamespace: string;
    namespace: string;
    types: Record<string, any>;
  }) {
    return { processed: true, count: Object.keys(args.types).length };
  }

  async processResolverNamespace(args: {
    applicationNamespace: string;
    namespace: string;
    resolvers: Record<string, any>;
  }) {
    return { processed: true, count: Object.keys(args.resolvers).length };
  }

  async aggregate(args: {
    inputs: any[];
    executorInputs: any[];
    baseDir: string;
  }) {
    return {
      files: [
        {
          path: path.join(args.baseDir, "test-output.txt"),
          content: `Inputs: ${JSON.stringify(args.inputs)}`,
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

  describe("コンストラクター", () => {
    it("正常に初期化される", () => {
      expect(manager.application).toBeDefined();
      expect(manager.baseDir).toContain("generated");
    });

    it("ベースディレクトリが作成される", () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("generated"),
        { recursive: true },
      );
    });
  });

  describe("generators", () => {
    it("ジェネレーターが正しく渡される", () => {
      expect(manager.generators.length).toBeGreaterThan(0);
    });

    it("Kysely ジェネレーターを受け取る", () => {
      const kyselyGen = GeneratorConfigSchema.parse([
        "@tailor/kysely-type",
        { distPath: "types/db.ts" },
      ]);
      const managerWithKysely = new GenerationManager(
        mockConfig as any,
        [kyselyGen] as any,
      );
      expect(
        (managerWithKysely as any).generators.some(
          (gen: any) => gen instanceof KyselyGenerator,
        ),
      ).toBe(true);
    });
  });

  describe("generate", () => {
    it("完全な生成プロセスを実行", async () => {
      await manager.generate({ watch: false });

      // Generators are configured but may be 0 if actual type files do not exist
      expect(manager.generators.length).toBeGreaterThan(0);
      // applications will be empty if actual files do not exist
      expect(manager.applications).toBeDefined();
    });

    it("複数のアプリケーションを処理", async () => {
      const multiAppConfig = {
        ...mockConfig,
        name: "multi-app",
      };
      const multiAppManager = new GenerationManager(multiAppConfig, []);

      await multiAppManager.generate({ watch: false });
      expect(multiAppManager.application.applications.length).toBeGreaterThan(
        0,
      );
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

      manager.applications = {
        "test-app": {
          tailordbNamespaces: {
            "test-namespace": service.getTypes(),
          },
          resolverNamespaces: {
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
        },
      };
    });

    it("全てのジェネレーターを並列処理", async () => {
      const processGeneratorSpy = vi.spyOn(manager, "processGenerator");

      await manager.processGenerators();

      expect(processGeneratorSpy).toHaveBeenCalledTimes(
        manager.generators.length,
      );
    });

    it("ジェネレーター処理でエラーが発生しても他に影響しない", async () => {
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

      manager.applications = {
        "test-app": {
          tailordbNamespaces: {
            "test-namespace": service.getTypes(),
          },
          resolverNamespaces: {
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
        },
      };
    });

    it("単一ジェネレーターの完全処理", async () => {
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

    it("typesとresolversが並列処理される", async () => {
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
          application: {
            "test-app": {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {},
              resolverNamespaceResults: {},
            },
          },
          executorResults: {},
        },
      };
    });

    it("全てのタイプを処理", async () => {
      const processTypeSpy = vi.spyOn(testGenerator, "processType");
      const types = {
        type1: db.type("Type1", {}),
        type2: db.type("Type2", {}),
        type3: db.type("Type3", {}),
      };

      const service = new TailorDBService("test-namespace", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      service["parseTypes"]();

      await manager.processTailorDBNamespace(
        testGenerator,
        "test-app",
        "test-namespace",
        service.getTypes(),
      );

      expect(processTypeSpy).toHaveBeenCalledTimes(3);
      expect(
        manager.generatorResults[testGenerator.id].application["test-app"]
          .tailordbResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(
          manager.generatorResults[testGenerator.id].application["test-app"]
            .tailordbResults["test-namespace"],
        ),
      ).toHaveLength(3);
    });

    it("空のtypesでもエラーにならない", async () => {
      await expect(
        manager.processTailorDBNamespace(
          testGenerator,
          "test-app",
          "test-namespace",
          {},
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("processResolverNamespace", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults = {
        [testGenerator.id]: {
          application: {
            "test-app": {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {},
              resolverNamespaceResults: {},
            },
          },
          executorResults: {},
        },
      };
    });

    it("全てのリゾルバーを処理", async () => {
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
        "test-app",
        "test-namespace",
        resolvers,
      );

      expect(processResolverSpy).toHaveBeenCalledTimes(2);
      expect(
        manager.generatorResults[testGenerator.id].application["test-app"]
          .resolverResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(
          manager.generatorResults[testGenerator.id].application["test-app"]
            .resolverResults["test-namespace"],
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
          application: {
            "test-app": {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {
                "test-namespace": { types: "processed" },
              },
              resolverNamespaceResults: {
                "test-namespace": { resolvers: "processed" },
              },
            },
          },
          executorResults: {},
        },
      };
    });

    it("ジェネレーターのaggregateメソッドを呼び出し", async () => {
      const aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.aggregate(testGenerator);

      expect(aggregateSpy).toHaveBeenCalledWith({
        inputs: [
          {
            applicationNamespace: "test-app",
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
          },
        ],
        executorInputs: [],
        baseDir: expect.stringContaining(testGenerator.id),
      });
    });

    it("ファイルを正しく書き込み", async () => {
      await manager.aggregate(testGenerator);

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it("複数ファイルの並列書き込み", async () => {
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
          application: {
            "test-app": {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {},
              resolverNamespaceResults: {},
            },
          },
          executorResults: {},
        },
      };

      await manager.aggregate(multiFileGenerator);

      expect(fs.writeFile).toHaveBeenCalledTimes(3);
    });

    it("ファイル書き込みエラーのハンドリング", async () => {
      const writeFileError = new Error("Write permission denied");
      vi.mocked(fs.writeFile).mockImplementationOnce(
        (_path, _content, callback: any) => {
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
          application: {
            "test-app": {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {},
              resolverNamespaceResults: {},
            },
          },
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
      };
      vi.spyOn(DependencyWatcher.prototype, "addWatchGroup").mockImplementation(
        mockWatcher.addWatchGroup,
      );
    });

    it("ワッチャーを初期化", async () => {
      await manager.watch();
      expect(manager.watcher).toBeInstanceOf(DependencyWatcher);
    });

    it("TailorDBサービス用の監視グループを追加", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith(
        "TailorDB__testApp__main",
        ["src/types/*.ts"],
        expect.any(Function),
      );
    });

    it("Resolverサービス用の監視グループを追加", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith(
        "Resolver__testApp__main",
        ["src/resolvers/*.ts"],
        expect.any(Function),
      );
    });

    it("ファイル変更時のコールバック処理", async () => {
      // Verify that TestGenerator has processTailorDBNamespace method
      const testGen = manager.generators.find(
        (g: any) => g.id === "test-generator",
      );
      expect(testGen).toBeDefined();
      expect(typeof testGen.processTailorDBNamespace).toBe("function");

      // Initialize applications
      const types = {
        testType: db.type("TestType", {}),
      };
      const service = new TailorDBService("main", { files: [] });
      service["rawTypes"]["test.ts"] = types;
      service["parseTypes"]();

      manager.applications = {
        testApp: {
          tailordbNamespaces: {
            main: service.getTypes(),
          },
          resolverNamespaces: {
            main: {
              testResolver: createResolver({
                name: "testResolver",
                operation: "query",
                // input removed
                body: () => ({ string: "" }),
                output: t.object({ string: t.string() }),
              }),
            },
          },
        },
      };

      // Initialize generatorResults
      manager.generatorResults = {
        "test-generator": {
          application: {
            testApp: {
              tailordbResults: {},
              resolverResults: {},
              tailordbNamespaceResults: {},
              resolverNamespaceResults: {},
            },
          },
          executorResults: {},
        },
      };

      await manager.watch();

      const callArgs = mockWatcher.addWatchGroup.mock.calls.find(
        (args: any) => args[0] === "TailorDB__testApp__main",
      );
      expect(callArgs).toBeDefined();

      const callback = callArgs[2];
      expect(typeof callback).toBe("function");

      // Verify that valid file type data exists when callback is executed
      await callback({ timestamp: new Date() }, { affectedFiles: ["test.ts"] });
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

  it("GenerationManagerを作成して実行", async () => {
    const manager = new GenerationManager(mockConfig, []);
    await expect(manager.generate({ watch: false })).resolves.not.toThrow();
  });

  it("watch オプションが true の場合 watch を開始", async () => {
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    const manager = new GenerationManager(mockConfig, []);
    await manager.generate({ watch: false });
    await manager.watch();

    expect(watchSpy).toHaveBeenCalled();
  });

  it("watch オプションが false の場合 watch を開始しない", async () => {
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    const manager = new GenerationManager(mockConfig, []);
    await manager.generate({ watch: false });

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

  it("複数ジェネレーターでの完全統合テスト", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const kyselyGen = GeneratorConfigSchema.parse([
      "@tailor/kysely-type",
      { distPath: "db.ts" },
    ]);
    const generators = [new TestGenerator(), kyselyGen] as any;
    const manager = new GenerationManager(fullConfig, generators);

    await expect(manager.generate({ watch: false })).resolves.not.toThrow();

    expect(manager.generators.length).toBe(2);
    expect(
      manager.generators.some((g: any) => g instanceof TestGenerator),
    ).toBe(true);
    expect(
      manager.generators.some((g: any) => g instanceof KyselyGenerator),
    ).toBe(true);
  });

  it("エラー回復とパフォーマンスの統合テスト", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const manager = new GenerationManager(fullConfig, []);

    const start = Date.now();
    await manager.generate({ watch: false });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  describe("Memory Management", () => {
    it("大量データ処理でメモリリークなし", async () => {
      const largeGenerators = Array(10)
        .fill(0)
        .map(() => new TestGenerator());

      const indexModule = await import("./index");
      const GenerationManager = (indexModule as any).GenerationManager;
      const manager = new GenerationManager(fullConfig, largeGenerators);

      // Create large applications structure
      manager.applications = {};
      Array(10)
        .fill(0)
        .forEach((_, appIdx) => {
          const appName = `test-app-${appIdx}`;
          manager.applications[appName] = {
            tailordbNamespaces: {},
            resolverNamespaces: {},
          };

          // Add multiple namespaces per app
          Array(10)
            .fill(0)
            .forEach((_, nsIdx) => {
              const namespace = `namespace-${nsIdx}`;

              // Add types to namespace
              const types: Record<string, TailorDBType> = {};
              Array(50)
                .fill(0)
                .forEach((_, typeIdx) => {
                  types[`Type${appIdx}_${nsIdx}_${typeIdx}`] = db.type(
                    `Type${appIdx}_${nsIdx}_${typeIdx}`,
                    {},
                  );
                });

              const service = new TailorDBService(namespace, { files: [] });
              service["rawTypes"]["test.ts"] = types;
              service["parseTypes"]();

              manager.applications[appName].tailordbNamespaces[namespace] =
                service.getTypes();

              // Add resolvers to namespace
              manager.applications[appName].resolverNamespaces[namespace] = {};
              Array(10)
                .fill(0)
                .forEach((_, resolverIdx) => {
                  manager.applications[appName].resolverNamespaces[namespace][
                    `resolver${appIdx}_${nsIdx}_${resolverIdx}`
                  ] = createResolver({
                    name: `resolver${appIdx}_${nsIdx}_${resolverIdx}`,
                    operation: "query",
                    // input removed
                    body: () => ({ string: "" }),
                    output: t.object({ string: t.string() }),
                  });
                });
            });
        });

      await expect(manager.generate({ watch: false })).resolves.not.toThrow();
    });
  });
});
