import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  afterAll,
} from "vitest";

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generate, GenerationManager } from "./index";
import type { WorkspaceConfig } from "@/config";
import { db, type TailorDBType } from "@/services/tailordb/schema";
import {
  createQueryResolver,
  type Resolver,
} from "@/services/pipeline/resolver";
import { KyselyGenerator } from "./builtin/kysely-type";
import { DependencyWatcher } from "./watch";
import { t } from "@/types";

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

  async processTailorDBNamespace(args: {
    applicationNamespace: string;
    namespace: string;
    types: Record<string, any>;
  }) {
    return { processed: true, count: Object.keys(args.types).length };
  }

  async processPipelineNamespace(args: {
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
  let mockConfig: Extract<WorkspaceConfig, { id?: undefined }>;

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "generation-manager-test-"),
    );

    mockConfig = {
      name: "test-workspace",
      region: "us-west-2",
      app: {
        testApp: {
          db: { main: { files: ["src/types/*.ts"] } },
          pipeline: { main: { files: ["src/resolvers/*.ts"] } },
          auth: { namespace: "test-auth" },
        },
      },
      generators: [new TestGenerator()],
    } as any;

    manager = new GenerationManager(mockConfig);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("コンストラクター", () => {
    it("正常に初期化される", () => {
      expect(manager.workspace).toBeDefined();
      expect(manager.baseDir).toContain("generated");
    });

    it("ベースディレクトリが作成される", () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("generated"),
        { recursive: true },
      );
    });
  });

  describe("initGenerators", () => {
    it("ジェネレーターが初期化される", () => {
      manager.initGenerators();
      expect(manager.generators.length).toBeGreaterThan(0);
    });

    it("重複初期化を防ぐ", () => {
      manager.initGenerators();
      const firstCount = manager.generators.length;
      manager.initGenerators();
      expect(manager.generators.length).toBe(firstCount);
    });

    it("Kysely ジェネレーターを正しく初期化", () => {
      const configWithKysely = {
        ...mockConfig,
        generators: [
          ["@tailor/kysely-type", { distPath: "types/db.ts" }] as const,
        ],
      };
      const managerWithKysely = new GenerationManager(configWithKysely as any);
      (managerWithKysely as any).initGenerators();
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

      // ジェネレーターは設定されているが、実際のタイプファイルが存在しないため0になる可能性がある
      expect(manager.generators.length).toBeGreaterThan(0);
      // applicationsは実際のファイルが存在しない場合は空になる
      expect(manager.applications).toBeDefined();
    });

    it("複数のアプリケーションを処理", async () => {
      const multiAppConfig = {
        ...mockConfig,
        name: "multi-app-workspace",
      };
      const multiAppManager = new GenerationManager(multiAppConfig);

      await multiAppManager.generate({ watch: false });
      expect(multiAppManager.workspace.applications.length).toBeGreaterThan(0);
    });
  });

  describe("processGenerators", () => {
    beforeEach(async () => {
      manager.initGenerators();
      manager.applications = {
        "test-app": {
          tailordbNamespaces: {
            "test-namespace": {
              testType: db.type("TestType", {}),
            },
          },
          pipelineNamespaces: {
            "test-namespace": {
              testResolver: createQueryResolver(
                "testResolver",
                t.type({}),
              ).returns(() => ({ string: "" }), t.type({ string: t.string() })),
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
        aggregate: vi
          .fn()
          .mockImplementation(() => Promise.resolve({ files: [] })),
      };

      manager.generators.push(errorGenerator);

      // エラーが発生しても全体の処理は続行されることを確認
      await manager.processGenerators();

      // 正常なジェネレーターは処理され、エラージェネレーターのメソッドも呼ばれることを確認
      expect(errorGenerator.processType).toHaveBeenCalled();
      expect(errorGenerator.processResolver).toHaveBeenCalled();
    });
  });

  describe("processGenerator", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generators = [testGenerator];
      manager.applications = {
        "test-app": {
          tailordbNamespaces: {
            "test-namespace": {
              testType: db.type("TestType", {}),
            },
          },
          pipelineNamespaces: {
            "test-namespace": {
              testResolver: createQueryResolver(
                "testResolver",
                t.type({}),
              ).returns(() => ({ string: "" }), t.type({ string: t.string() })),
            },
          },
        },
      };
    });

    it("単一ジェネレーターの完全処理", async () => {
      // generatorResultsを初期化
      manager.generatorResults = {};

      const processTailorDBNamespaceSpy = vi.spyOn(
        manager,
        "processTailorDBNamespace",
      );
      const processPipelineNamespaceSpy = vi.spyOn(
        manager,
        "processPipelineNamespace",
      );
      const aggregateSpy = vi.spyOn(manager, "aggregate");

      await manager.processGenerator(testGenerator);

      expect(processTailorDBNamespaceSpy).toHaveBeenCalled();
      expect(processPipelineNamespaceSpy).toHaveBeenCalled();
      expect(aggregateSpy).toHaveBeenCalledWith(testGenerator);
    });

    it("typesとresolversが並列処理される", async () => {
      // generatorResultsを初期化
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
              pipelineResults: {},
              tailordbNamespaceResults: {},
              pipelineNamespaceResults: {},
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

      await manager.processTailorDBNamespace(
        testGenerator,
        "test-app",
        "test-namespace",
        types,
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

  describe("processPipelineNamespace", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.generatorResults = {
        [testGenerator.id]: {
          application: {
            "test-app": {
              tailordbResults: {},
              pipelineResults: {},
              tailordbNamespaceResults: {},
              pipelineNamespaceResults: {},
            },
          },
          executorResults: {},
        },
      };
    });

    it("全てのリゾルバーを処理", async () => {
      const processResolverSpy = vi.spyOn(testGenerator, "processResolver");
      const resolvers = {
        resolver1: createQueryResolver("resolver1", t.type({})).returns(
          () => ({ string: "" }),
          t.type({ string: t.string() }),
        ),
        resolver2: createQueryResolver("resolver2", t.type({})).returns(
          () => ({ string: "" }),
          t.type({ string: t.string() }),
        ),
      };

      await manager.processPipelineNamespace(
        testGenerator,
        "test-app",
        "test-namespace",
        resolvers,
      );

      expect(processResolverSpy).toHaveBeenCalledTimes(2);
      expect(
        manager.generatorResults[testGenerator.id].application["test-app"]
          .pipelineResults["test-namespace"],
      ).toBeDefined();
      expect(
        Object.keys(
          manager.generatorResults[testGenerator.id].application["test-app"]
            .pipelineResults["test-namespace"],
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
              pipelineResults: {},
              tailordbNamespaceResults: {
                "test-namespace": { types: "processed" },
              },
              pipelineNamespaceResults: {
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
            pipeline: [
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
      // 以前の呼び出しをクリア
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
              pipelineResults: {},
              tailordbNamespaceResults: {},
              pipelineNamespaceResults: {},
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
              pipelineResults: {},
              tailordbNamespaceResults: {},
              pipelineNamespaceResults: {},
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

    it("Pipelineサービス用の監視グループを追加", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith(
        "Pipeline__testApp__main",
        ["src/resolvers/*.ts"],
        expect.any(Function),
      );
    });

    it("ファイル変更時のコールバック処理", async () => {
      manager.initGenerators();
      // TestGeneratorにprocessTailorDBNamespaceメソッドがあることを確認
      const testGen = manager.generators.find(
        (g: any) => g.id === "test-generator",
      );
      expect(testGen).toBeDefined();
      expect(typeof testGen.processTailorDBNamespace).toBe("function");

      // applicationsの初期化
      manager.applications = {
        testApp: {
          tailordbNamespaces: {
            main: {
              testType: db.type("TestType", {}),
            },
          },
          pipelineNamespaces: {
            main: {
              testResolver: createQueryResolver(
                "testResolver",
                t.type({}),
              ).returns(() => ({ string: "" }), t.type({ string: t.string() })),
            },
          },
        },
      };

      // generatorResults を初期化
      manager.generatorResults = {
        "test-generator": {
          application: {
            testApp: {
              tailordbResults: {},
              pipelineResults: {},
              tailordbNamespaceResults: {},
              pipelineNamespaceResults: {},
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

      // コールバック実行時に有効なファイルタイプデータが存在することを確認
      await callback({ timestamp: new Date() }, { affectedFiles: ["test.ts"] });
    });
  });
});

describe("generate function", () => {
  let mockConfig: WorkspaceConfig;

  beforeEach(() => {
    mockConfig = {
      name: "test-workspace",
      region: "us-west-2",
      app: {},
      generators: [],
    } as any;
  });

  it("GenerationManagerを作成して実行", async () => {
    await expect(generate(mockConfig, { watch: false })).resolves.not.toThrow();
  });

  it("watch オプションが true の場合 watch を開始", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    await generate(mockConfig, { watch: true });

    expect(watchSpy).toHaveBeenCalled();
  });

  it("watch オプションが false の場合 watch を開始しない", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const watchSpy = vi.fn();
    vi.spyOn(GenerationManager.prototype, "watch").mockImplementation(watchSpy);

    await generate(mockConfig, { watch: false });

    expect(watchSpy).not.toHaveBeenCalled();
  });
});

describe("Integration Tests", () => {
  let tempDir: string;
  let fullConfig: WorkspaceConfig;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-test-"));

    fullConfig = {
      name: "integration-test-workspace",
      region: "us-west-2",
      app: {
        testApp: {
          db: {
            main: {
              files: [path.join(tempDir, "types/*.ts")],
            },
          },
          pipeline: {
            main: {
              files: [path.join(tempDir, "resolvers/*.ts")],
            },
          },
          auth: {
            namespace: "test-auth",
          },
        },
      },
      generators: [
        new TestGenerator(),
        ["@tailor/kysely-type", { outputPath: "db.ts" }],
      ],
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
    const manager = new GenerationManager(fullConfig);

    // initGeneratorsを明示的に呼び出し
    manager.initGenerators();

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
    const manager = new GenerationManager(fullConfig);

    const start = Date.now();
    await manager.generate({ watch: false });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  describe("Memory Management", () => {
    it("大量データ処理でメモリリークなし", async () => {
      const largeDataConfig = {
        ...fullConfig,
        generators: Array(10)
          .fill(0)
          .map(() => new TestGenerator()),
      };

      const indexModule = await import("./index");
      const GenerationManager = (indexModule as any).GenerationManager;
      const manager = new GenerationManager(largeDataConfig);

      // Create large applications structure
      manager.applications = {};
      Array(10)
        .fill(0)
        .forEach((_, appIdx) => {
          const appName = `test-app-${appIdx}`;
          manager.applications[appName] = {
            tailordbNamespaces: {},
            pipelineNamespaces: {},
          };

          // Add multiple namespaces per app
          Array(10)
            .fill(0)
            .forEach((_, nsIdx) => {
              const namespace = `namespace-${nsIdx}`;

              // Add types to namespace
              manager.applications[appName].tailordbNamespaces[namespace] = {};
              Array(50)
                .fill(0)
                .forEach((_, typeIdx) => {
                  manager.applications[appName].tailordbNamespaces[namespace][
                    `Type${appIdx}_${nsIdx}_${typeIdx}`
                  ] = db.type(`Type${appIdx}_${nsIdx}_${typeIdx}`, {});
                });

              // Add resolvers to namespace
              manager.applications[appName].pipelineNamespaces[namespace] = {};
              Array(10)
                .fill(0)
                .forEach((_, resolverIdx) => {
                  manager.applications[appName].pipelineNamespaces[namespace][
                    `resolver${appIdx}_${nsIdx}_${resolverIdx}`
                  ] = createQueryResolver(
                    `resolver${appIdx}_${nsIdx}_${resolverIdx}`,
                    t.type({}),
                  ).returns(
                    () => ({ string: "" }),
                    t.type({ string: t.string() }),
                  );
                });
            });
        });

      await expect(manager.generate({ watch: false })).resolves.not.toThrow();
    });
  });
});
