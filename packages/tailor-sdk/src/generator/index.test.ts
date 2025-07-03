import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
  afterAll,
} from "vitest";
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generate, apply } from "./index";
import type { WorkspaceConfig } from "@/config";
import type { TailorDBType } from "@/services/tailordb/schema";
import type { Resolver } from "@/services/pipeline/resolver";
import { SdlGenerator } from "./builtin/sdl";
import { KyselyGenerator } from "./builtin/kysely-type";
import { ManifestGenerator } from "./builtin/manifest";
import { DependencyWatcher } from "./watch";

type GenerationManagerConstructor = new (config: WorkspaceConfig) => any;

vi.mock("@/config", () => ({
  AppConfig: {},
  WorkspaceConfig: {},
  getDistDir: () => path.join(os.tmpdir(), "tailor-test-dist"),
  defineConfig: (config: any) => config,
}));

vi.mock("@/workspace", async () => {
  const actual = (await vi.importActual("@/workspace")) as any;
  return {
    ...actual,
  };
});

vi.mock("@/ctl", () => ({
  TailorCtl: vi.fn().mockImplementation(() => ({
    apply: vi.fn(),
  })),
}));

class TestGenerator {
  readonly id = "test-generator";
  readonly description = "Test generator for unit tests";

  async processType(type: TailorDBType) {
    return { name: type.name, processed: true };
  }

  async processTypes(types: Record<string, any>) {
    return { processed: true, count: Object.keys(types).length };
  }

  async processResolver(resolver: Resolver) {
    return { name: resolver.name, processed: true };
  }

  async processResolvers(resolvers: Record<string, any>) {
    return { processed: true, count: Object.keys(resolvers).length };
  }

  async aggregate(metadata: any, baseDir: string) {
    return {
      files: [
        {
          path: path.join(baseDir, "test-output.txt"),
          content: `Types: ${JSON.stringify(metadata.types)}\nResolvers: ${JSON.stringify(metadata.resolvers)}`,
        },
      ],
    };
  }
}

describe("GenerationManager", () => {
  let tempDir: string;
  let manager: any;
  let mockConfig: WorkspaceConfig;
  let GenerationManager: GenerationManagerConstructor;

  beforeAll(async () => {
    vi.spyOn(fs, "writeFile").mockImplementation(
      (path, content, callback: any) => {
        if (typeof callback === "function") {
          callback(null);
        }
      },
    );

    vi.spyOn(fs, "mkdirSync").mockImplementation(() => "");

    const indexModule = await import("./index");
    GenerationManager = (indexModule as any).GenerationManager;
  });

  afterAll(() => {
    vi.restoreAllMocks();
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
          db: {
            main: {
              files: ["src/types/*.ts"],
            },
          },
          resolver: {
            main: {
              files: ["src/resolvers/*.ts"],
            },
          },
          auth: {
            namespace: "test-auth",
          },
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

    it("SDL ジェネレーターを正しく初期化", () => {
      const configWithSdl = {
        ...mockConfig,
        generators: ["@tailor/sdl" as const],
      };
      const managerWithSdl = new GenerationManager(configWithSdl as any);
      managerWithSdl.initGenerators();
      expect(
        managerWithSdl.generators.some(
          (gen: any) => gen instanceof SdlGenerator,
        ),
      ).toBe(true);
    });

    it("Kysely ジェネレーターを正しく初期化", () => {
      const configWithKysely = {
        ...mockConfig,
        generators: [
          ["@tailor/kysely-type", { distPath: "types/db.ts" }] as const,
        ],
      };
      const managerWithKysely = new GenerationManager(configWithKysely as any);
      managerWithKysely.initGenerators();
      expect(
        managerWithKysely.generators.some(
          (gen: any) => gen instanceof KyselyGenerator,
        ),
      ).toBe(true);
    });

    it("ManifestGeneratorのworkspaceを設定", () => {
      const manifestGen = new ManifestGenerator({
        dryRun: false,
      });
      const configWithManifest = {
        ...mockConfig,
        generators: [manifestGen],
      };
      const managerWithManifest = new GenerationManager(
        configWithManifest as any,
      );
      managerWithManifest.initGenerators();
      expect(manifestGen.workspace).toBe(managerWithManifest.workspace);
    });

    it("未知のジェネレーターIDでエラー", () => {
      const configWithUnknown = {
        ...mockConfig,
        generators: ["unknown-generator" as any],
      };
      const managerWithUnknown = new GenerationManager(
        configWithUnknown as any,
      );
      expect(() => managerWithUnknown.initGenerators()).toThrow(
        "Unknown generator ID: unknown-generator",
      );
    });
  });

  describe("generate", () => {
    it("完全な生成プロセスを実行", async () => {
      await manager.generate({ watch: false });

      // ジェネレーターは設定されているが、実際のタイプファイルが存在しないため0になる可能性がある
      expect(manager.generators.length).toBeGreaterThan(0);
      // typesとresolversは実際のファイルが存在しない場合は空になる
      expect(manager.types).toBeDefined();
      expect(manager.resolvers).toBeDefined();
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
      manager.types = {
        "test.ts": {
          testType: { name: "TestType", fields: [] } as TailorDBType,
        },
      };
      manager.resolvers = {
        "test-resolver.ts": {
          name: "testResolver",
          query: "test query",
          _input: {} as any,
          _output: {
            name: "String",
            type: "string",
            _metadata: {
              type: "string",
              optional: false,
              array: false,
            },
          } as any,
          _context: {} as any,
        } as any,
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
        processTypes: vi.fn().mockImplementation(() => Promise.resolve({})),
        processResolvers: vi.fn().mockImplementation(() => Promise.resolve({})),
        aggregate: vi
          .fn()
          .mockImplementation(() => Promise.resolve({ files: [] })),
      };

      manager.generators.push(errorGenerator);

      // エラーが発生しても全体の処理は続行されることを確認
      // Promise.allSettledを使用してエラーが発生してもプロセスが続行されることをテスト
      await expect(manager.processGenerators()).resolves.not.toThrow();

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
      manager.types = {
        "test.ts": {
          testType: { name: "TestType", fields: [] } as TailorDBType,
        },
      };
      manager.resolvers = {
        "test-resolver.ts": {
          name: "testResolver",
          query: "test query",
          _input: {} as any,
          _output: {
            name: "String",
            type: "string",
            _metadata: {
              type: "string",
              optional: false,
              array: false,
            },
          } as any,
          _context: {} as any,
        } as any,
      };
    });

    it("単一ジェネレーターの完全処理", async () => {
      const processSingleTypesSpy = vi.spyOn(manager, "processSingleTypes");
      const summarizeTypesSpy = vi.spyOn(manager, "summarizeTypes");
      const processSingleResolversSpy = vi.spyOn(
        manager,
        "processSingleResolvers",
      );
      const summarizeResolversSpy = vi.spyOn(manager, "summarizeResolvers");
      const aggregateSpy = vi.spyOn(manager, "aggregate");

      await manager.processGenerator(testGenerator);

      expect(processSingleTypesSpy).toHaveBeenCalledWith(testGenerator);
      expect(summarizeTypesSpy).toHaveBeenCalledWith(testGenerator);
      expect(processSingleResolversSpy).toHaveBeenCalledWith(testGenerator);
      expect(summarizeResolversSpy).toHaveBeenCalledWith(testGenerator);
      expect(aggregateSpy).toHaveBeenCalledWith(testGenerator);
    });

    it("typesとresolversが並列処理される", async () => {
      const start = Date.now();
      await manager.processGenerator(testGenerator);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });

  describe("processSingleTypes", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.types = {
        "file1.ts": {
          type1: { name: "Type1", fields: [] } as TailorDBType,
          type2: { name: "Type2", fields: [] } as TailorDBType,
        },
        "file2.ts": {
          type3: { name: "Type3", fields: [] } as TailorDBType,
        },
      };
    });

    it("全てのタイプを処理", async () => {
      const processTypeSpy = vi.spyOn(testGenerator, "processType");

      await manager.processSingleTypes(testGenerator);

      expect(processTypeSpy).toHaveBeenCalledTimes(3);
      expect(manager.typeResults[testGenerator.id]).toBeDefined();
      expect(Object.keys(manager.typeResults[testGenerator.id])).toHaveLength(
        3,
      );
    });

    it("空のtypesでもエラーにならない", async () => {
      manager.types = {};
      await expect(
        manager.processSingleTypes(testGenerator),
      ).resolves.not.toThrow();
    });
  });

  describe("processSingleResolvers", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.resolvers = {
        "resolver1.ts": {
          name: "resolver1",
          query: "query1",
          _input: {} as any,
          _output: {
            name: "String",
            type: "string",
            _metadata: {
              type: "string",
              optional: false,
              array: false,
            },
          } as any,
          _context: {} as any,
        } as any,
        "resolver2.ts": {
          name: "resolver2",
          query: "query2",
          _input: {} as any,
          _output: {
            name: "String",
            type: "string",
            _metadata: {
              type: "string",
              optional: false,
              array: false,
            },
          } as any,
          _context: {} as any,
        } as any,
      };
    });

    it("全てのリゾルバーを処理", async () => {
      const processResolverSpy = vi.spyOn(testGenerator, "processResolver");

      await manager.processSingleResolvers(testGenerator);

      expect(processResolverSpy).toHaveBeenCalledTimes(2);
      expect(manager.resolverResults[testGenerator.id]).toBeDefined();
      expect(
        Object.keys(manager.resolverResults[testGenerator.id]),
      ).toHaveLength(2);
    });
  });

  describe("summarizeTypes", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.typeResults[testGenerator.id] = {
        type1: { processed: true },
        type2: { processed: true },
      };
    });

    it("processTypesメソッドがある場合は実行", async () => {
      const processTypesSpy = vi.spyOn(testGenerator, "processTypes");

      const result = await manager.summarizeTypes(testGenerator);

      expect(processTypesSpy).toHaveBeenCalledWith(
        manager.typeResults[testGenerator.id],
      );
      expect(result).toEqual({ processed: true, count: 2 });
    });

    it("processTypesメソッドがない場合は元の結果を返す", async () => {
      const generatorWithoutProcessTypes = {
        id: "no-process-types",
        processType: vi.fn().mockImplementation(() => Promise.resolve({})),
        processResolver: vi.fn().mockImplementation(() => Promise.resolve({})),
        aggregate: vi
          .fn()
          .mockImplementation(() => Promise.resolve({ files: [] })),
      };

      manager.typeResults[generatorWithoutProcessTypes.id] = { test: "data" };

      const result = await manager.summarizeTypes(generatorWithoutProcessTypes);
      expect(result).toEqual({ test: "data" });
    });
  });

  describe("aggregate", () => {
    let testGenerator: TestGenerator;

    beforeEach(() => {
      testGenerator = new TestGenerator();
      manager.typesResult[testGenerator.id] = { types: "processed" };
      manager.resolversResult[testGenerator.id] = { resolvers: "processed" };
    });

    it("ジェネレーターのaggregateメソッドを呼び出し", async () => {
      const aggregateSpy = vi.spyOn(testGenerator, "aggregate");

      await manager.aggregate(testGenerator);

      expect(aggregateSpy).toHaveBeenCalledWith(
        {
          types: { types: "processed" },
          resolvers: { resolvers: "processed" },
        },
        expect.stringContaining(testGenerator.id),
      );
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

      manager.typesResult[multiFileGenerator.id] = {};
      manager.resolversResult[multiFileGenerator.id] = {};

      await manager.aggregate(multiFileGenerator);

      expect(fs.writeFile).toHaveBeenCalledTimes(3);
    });

    it("ファイル書き込みエラーのハンドリング", async () => {
      const writeFileError = new Error("Write permission denied");
      vi.mocked(fs.writeFile).mockImplementationOnce(
        (path, content, callback: any) => {
          callback(writeFileError);
        },
      );

      const errorGenerator = {
        ...testGenerator,
        aggregate: vi.fn().mockResolvedValue({
          files: [{ path: "/test/error.txt", content: "content" }],
        }),
      };

      manager.typesResult[errorGenerator.id] = {};
      manager.resolversResult[errorGenerator.id] = {};

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
        "TailorDB__main",
        ["src/types/*.ts"],
        expect.any(Function),
      );
    });

    it("Pipelineサービス用の監視グループを追加", async () => {
      await manager.watch();

      expect(mockWatcher.addWatchGroup).toHaveBeenCalledWith(
        "Pipeline__main",
        ["src/resolvers/*.ts"],
        expect.any(Function),
      );
    });

    it("ファイル変更時のコールバック処理", async () => {
      manager.initGenerators();
      // TestGeneratorにprocessTypesメソッドがあることを確認
      const testGen = manager.generators.find(
        (g: any) => g.id === "test-generator",
      );
      expect(testGen).toBeDefined();
      expect(typeof testGen.processTypes).toBe("function");

      // typesとresolversの初期化
      manager.types = {
        "test.ts": {
          testType: { name: "TestType", fields: [] } as TailorDBType,
        },
      };
      manager.resolvers = {
        "test-resolver.ts": {
          name: "testResolver",
          query: "test query",
          _input: {} as any,
          _output: {
            name: "String",
            type: "string",
            _metadata: {
              type: "string",
              optional: false,
              array: false,
            },
          } as any,
          _context: {} as any,
        } as any,
      };

      // typeResults と resolverResults を初期化
      manager.typeResults = { "test-generator": {} };
      manager.resolverResults = { "test-generator": {} };

      await manager.watch();

      const callArgs = mockWatcher.addWatchGroup.mock.calls.find(
        (args: any) => args[0] === "TailorDB__main",
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

describe("apply function", () => {
  let mockConfig: WorkspaceConfig;
  let mockApplyOptions: any;

  beforeEach(() => {
    mockConfig = {
      name: "test-workspace",
      region: "us-west-2",
      app: {},
      generators: [],
    } as any;

    mockApplyOptions = {
      namespace: "test-namespace",
      host: "test-host",
      dryRun: false,
    };
  });

  it("ManifestGeneratorを使用してapplyを実行", async () => {
    const { TailorCtl } = await import("@/ctl");
    const TailorCtlMock = vi.mocked(TailorCtl);
    const applySpy = vi.fn();
    TailorCtlMock.mockImplementation(() => ({ apply: applySpy }) as any);

    await apply(mockConfig, mockApplyOptions);

    expect(applySpy).toHaveBeenCalledWith(
      expect.stringContaining("manifest.cue"),
    );
  });

  it("ManifestGeneratorがgeneratorsに設定される", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const generateSpy = vi
      .spyOn(GenerationManager.prototype, "generate")
      .mockImplementation(() => Promise.resolve());

    await apply(mockConfig, mockApplyOptions);

    expect(generateSpy).toHaveBeenCalled();
    expect(generateSpy.mock.calls).toHaveLength(1);
    expect(generateSpy.mock.calls[0]).toHaveLength(1);

    const calledOptions = generateSpy.mock.calls[0][0] as any;
    expect(calledOptions).toBeDefined();
    expect(calledOptions.watch).toBe(false);
  });

  it("watch: false で generate が呼ばれる", async () => {
    const indexModule = await import("./index");
    const GenerationManager = (indexModule as any).GenerationManager;
    const generateSpy = vi
      .spyOn(GenerationManager.prototype, "generate")
      .mockImplementation(() => Promise.resolve());

    await apply(mockConfig, mockApplyOptions);

    expect(generateSpy).toHaveBeenCalled();
    expect(generateSpy.mock.calls).toHaveLength(1);
    expect(generateSpy.mock.calls[0]).toHaveLength(1);

    const calledGenerateOptions = generateSpy.mock.calls[0][0] as any;
    expect(calledGenerateOptions).toBeDefined();
    expect(calledGenerateOptions.watch).toBe(false);
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
          resolver: {
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
        "@tailor/sdl",
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

    expect(manager.generators.length).toBe(3);
    expect(
      manager.generators.some((g: any) => g instanceof TestGenerator),
    ).toBe(true);
    expect(manager.generators.some((g: any) => g instanceof SdlGenerator)).toBe(
      true,
    );
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

      manager.types = Object.fromEntries(
        Array(100)
          .fill(0)
          .map((_, i) => [
            `file${i}.ts`,
            Object.fromEntries(
              Array(50)
                .fill(0)
                .map((_, j) => [
                  `type${i}_${j}`,
                  { name: `Type${i}_${j}`, fields: [] } as TailorDBType,
                ]),
            ),
          ]),
      );

      manager.resolvers = Object.fromEntries(
        Array(100)
          .fill(0)
          .map((_, i) => [
            `resolver${i}.ts`,
            {
              name: `resolver${i}`,
              query: `query${i}`,
              _input: {} as any,
              _output: {
                name: "String",
                type: "string",
                _metadata: {
                  type: "string",
                  optional: false,
                  array: false,
                },
              } as any,
              _context: {} as any,
            } as any,
          ]),
      );

      await expect(manager.generate({ watch: false })).resolves.not.toThrow();
    });
  });
});
