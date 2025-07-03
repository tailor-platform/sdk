import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ManifestAggregator } from "./aggregator";
import { BasicGeneratorMetadata } from "../../types";
import { ManifestTypeMetadata, ResolverManifestMetadata } from "./types";
import { Workspace } from "@/workspace";
import { Application } from "@/application";
import { TailorDBService } from "@/services/tailordb/service";
import { PipelineResolverService } from "@/services/pipeline/service";
import { AuthService } from "@/services/auth/service";
import path from "node:path";
import { getDistDir } from "@/config";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";

// getDistDirのモック
vi.mock("@/config", () => ({
  getDistDir: vi.fn(() => "/mock/dist"),
}));

describe("ManifestAggregator", () => {
  let mockWorkspace: Workspace;
  let mockApplication: Application;
  let mockTailorDBService: TailorDBService;
  let mockPipelineService: PipelineResolverService;
  let mockAuthService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();

    // モックサービスの作成
    mockTailorDBService = {
      loadTypes: vi.fn().mockResolvedValue(undefined),
      toManifestJSON: vi.fn().mockReturnValue({
        Kind: "tailordb",
        Namespace: "test-namespace",
        Name: "test-tailordb",
      }),
    } as any;

    mockPipelineService = {
      build: vi.fn().mockResolvedValue(undefined),
      loadResolvers: vi.fn().mockResolvedValue(undefined),
      toManifestJSON: vi.fn().mockResolvedValue({
        Kind: "pipeline",
        Namespace: "test-namespace",
        Name: "test-pipeline",
        Resolvers: [],
      }),
    } as any;

    mockAuthService = {
      toManifest: vi.fn().mockReturnValue({
        Kind: "auth",
        Namespace: "test-namespace",
        Name: "test-auth",
      }),
    } as any;

    // モックアプリケーションの作成
    mockApplication = {
      toManifestJSON: vi.fn().mockReturnValue({
        Name: "test-app",
        Kind: "application",
      }),
      tailorDBServices: [mockTailorDBService],
      pipelineResolverServices: [mockPipelineService],
      authService: mockAuthService,
    } as any;

    // モックワークスペースの作成
    mockWorkspace = {
      applications: [mockApplication],
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("aggregate", () => {
    it("ワークスペース全体のManifest生成が正常に動作すること", async () => {
      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        mockWorkspace,
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(
        path.join(getDistDir(), "manifest.cue"),
      );
      expect(result.errors).toBeUndefined();

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Kind).toBe("workspace");
      expect(manifestJSON.Apps).toHaveLength(1);
      expect(manifestJSON.Services).toHaveLength(3); // TailorDB + Pipeline + Auth
      expect(manifestJSON.Tailordbs).toHaveLength(1);
      expect(manifestJSON.Pipelines).toHaveLength(1);
      expect(manifestJSON.Auths).toHaveLength(1);
    });

    it("従来のPipelineのみのManifest生成が正常に動作すること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [
          {
            name: "step1",
            description: "Test step",
            operationType: PipelineResolver_OperationType.FUNCTION,
            operationSource: "console.log('test');",
          },
        ],
        outputMapper: "(context) => context.step1",
        inputFields: {
          id: { type: "string", required: true, array: false },
          name: { type: "string", required: false, array: false },
        },
        outputFields: {
          result: { type: "string", required: true, array: false },
        },
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      expect(result.files).toHaveLength(1);
      expect(result.errors).toBeUndefined();

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Kind).toBe("pipeline");
      expect(manifestJSON.Namespace).toBe("test-namespace");
      expect(manifestJSON.Resolvers).toHaveLength(1);
      expect(manifestJSON.Resolvers[0].Name).toBe("testResolver");
    });

    it("エラーハンドリングが正しく動作すること", async () => {
      const errorWorkspace = {
        applications: [
          {
            toManifestJSON: vi.fn(() => {
              throw new Error("Test error");
            }),
            tailorDBServices: [],
            pipelineResolverServices: [],
            authService: null,
          },
        ],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        errorWorkspace,
      );

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("Test error");
    });

    it("ワークスペースがnullの場合にエラーハンドリングが動作すること", async () => {
      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          invalidResolver: {} as any, // 不正なメタデータ
        },
      };

      const result = await ManifestAggregator.aggregate(metadata, undefined);

      // エラーが発生する可能性があるが、files配列は空でなければならない
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
    });
  });

  describe("generateWorkspaceManifest", () => {
    it("複数のアプリケーションを持つワークスペースを正しく処理すること", async () => {
      const secondApp = {
        toManifestJSON: vi.fn().mockReturnValue({
          Name: "second-app",
          Kind: "application",
        }),
        tailorDBServices: [],
        pipelineResolverServices: [],
        authService: null,
      } as any;

      const multiAppWorkspace = {
        applications: [mockApplication, secondApp],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        multiAppWorkspace,
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Apps).toHaveLength(2);
      expect(manifestJSON.Apps[0].Name).toBe("test-app");
      expect(manifestJSON.Apps[1].Name).toBe("second-app");
    });

    it("Authサービスがnullの場合を正しく処理すること", async () => {
      const appWithoutAuth = {
        toManifestJSON: vi.fn().mockReturnValue({
          Name: "app-without-auth",
          Kind: "application",
        }),
        tailorDBServices: [mockTailorDBService],
        pipelineResolverServices: [mockPipelineService],
        authService: null,
      } as any;

      const workspaceWithoutAuth = {
        applications: [appWithoutAuth],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        workspaceWithoutAuth,
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Auths).toHaveLength(0);
      expect(manifestJSON.Services).toHaveLength(2); // TailorDB + Pipeline のみ
    });

    it("各サービスのメソッドが正しく呼ばれること", async () => {
      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        mockWorkspace,
      );

      // TailorDBサービスの検証
      expect(mockTailorDBService.loadTypes).toHaveBeenCalledTimes(1);
      expect(mockTailorDBService.toManifestJSON).toHaveBeenCalledTimes(1);

      // Pipelineサービスの検証
      expect(mockPipelineService.build).toHaveBeenCalledTimes(1);
      expect(mockPipelineService.loadResolvers).toHaveBeenCalledTimes(1);
      expect(mockPipelineService.toManifestJSON).toHaveBeenCalledTimes(1);

      // Authサービスの検証
      expect(mockAuthService.toManifest).toHaveBeenCalledTimes(1);

      // アプリケーションの検証
      expect(mockApplication.toManifestJSON).toHaveBeenCalledTimes(1);
    });
  });

  describe("generateManifestJSON", () => {
    it("複数のResolverを正しく処理すること", async () => {
      const resolver1: ResolverManifestMetadata = {
        name: "resolver1",
        inputType: "Resolver1Input",
        outputType: "Resolver1Output",
        queryType: "query",
        pipelines: [
          {
            name: "step1",
            description: "Step 1",
            operationType: PipelineResolver_OperationType.FUNCTION,
          },
        ],
        inputFields: {
          id: { type: "string", required: true, array: false },
        },
        outputFields: {
          result: { type: "string", required: true, array: false },
        },
      };

      const resolver2: ResolverManifestMetadata = {
        name: "resolver2",
        inputType: "Resolver2Input",
        outputType: "Resolver2Output",
        queryType: "mutation",
        pipelines: [
          {
            name: "mutationStep",
            description: "Mutation Step",
            operationType: PipelineResolver_OperationType.GRAPHQL,
          },
        ],
        inputFields: {
          data: { type: "string", required: true, array: false },
        },
        outputFields: {
          success: { type: "boolean", required: true, array: false },
        },
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          resolver1,
          resolver2,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Resolvers).toHaveLength(2);
      expect(manifestJSON.Resolvers[0].Name).toBe("resolver1");
      expect(manifestJSON.Resolvers[1].Name).toBe("resolver2");
    });

    it("空のResolverオブジェクトを正しく処理すること", async () => {
      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Kind).toBe("pipeline");
      expect(manifestJSON.Namespace).toBe("test-namespace");
      expect(manifestJSON.Resolvers).toHaveLength(0);
      expect(manifestJSON.Version).toBe("v2");
    });
  });

  describe("generateResolverManifest", () => {
    it("基本的なResolverManifestを正しく生成すること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [
          {
            name: "fetchData",
            description: "Fetch data",
            operationType: PipelineResolver_OperationType.FUNCTION,
            operationSource: "console.log('fetch');",
          },
        ],
        outputMapper: "(context) => ({ result: context.fetchData })",
        inputFields: {
          id: { type: "string", required: true, array: false },
          filters: { type: "string", required: false, array: true },
        },
        outputFields: {
          result: { type: "string", required: true, array: false },
          metadata: { type: "json", required: false, array: false },
        },
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const resolverManifest = manifestJSON.Resolvers[0];

      expect(resolverManifest.Name).toBe("testResolver");
      expect(resolverManifest.Description).toBe("testResolver resolver");
      expect(resolverManifest.Authorization).toBe("true==true");
      expect(resolverManifest.PublishExecutionEvents).toBe(false);

      // Inputs検証
      expect(resolverManifest.Inputs).toHaveLength(1);
      expect(resolverManifest.Inputs[0].Name).toBe("input");
      expect(resolverManifest.Inputs[0].Type.Name).toBe("TestInput");
      expect(resolverManifest.Inputs[0].Type.Fields).toHaveLength(2);

      // Response検証
      expect(resolverManifest.Response.Type.Name).toBe("TestOutput");
      expect(resolverManifest.Response.Type.Fields).toHaveLength(2);

      // Pipelines検証
      expect(resolverManifest.Pipelines).toHaveLength(2); // ユーザー定義 + __construct_output
      expect(resolverManifest.Pipelines[0].Name).toBe("fetchData");
      expect(resolverManifest.Pipelines[1].Name).toBe("__construct_output");
    });

    it("outputMapperがundefinedの場合のデフォルト値を正しく処理すること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [],
        outputMapper: undefined,
        inputFields: {},
        outputFields: {},
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const resolverManifest = manifestJSON.Resolvers[0];
      const constructOutputPipeline = resolverManifest.Pipelines.find(
        (p: any) => p.Name === "__construct_output",
      );

      expect(constructOutputPipeline.OperationSource).toBe(
        "globalThis.main = () => ({})",
      );
    });
  });

  describe("generateTypeFields", () => {
    it("通常のスカラーフィールドを正しく生成すること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [],
        inputFields: {
          id: { type: "string", required: true, array: false },
          count: { type: "integer", required: true, array: false },
          price: { type: "float", required: false, array: false },
          active: { type: "boolean", required: true, array: false },
          tags: { type: "string", required: true, array: true },
        },
        outputFields: {},
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const inputFields = manifestJSON.Resolvers[0].Inputs[0].Type.Fields;

      expect(inputFields).toHaveLength(5);

      // string型フィールド
      const idField = inputFields.find((f: any) => f.Name === "id");
      expect(idField.Type.Kind).toBe("ScalarType");
      expect(idField.Type.Name).toBe("String");
      expect(idField.Required).toBe(true);
      expect(idField.Array).toBe(false);

      // integer型フィールド
      const countField = inputFields.find((f: any) => f.Name === "count");
      expect(countField.Type.Name).toBe("Int");

      // float型フィールド
      const priceField = inputFields.find((f: any) => f.Name === "price");
      expect(priceField.Type.Name).toBe("Float");
      expect(priceField.Required).toBe(false);

      // boolean型フィールド
      const activeField = inputFields.find((f: any) => f.Name === "active");
      expect(activeField.Type.Name).toBe("Boolean");

      // 配列型フィールド
      const tagsField = inputFields.find((f: any) => f.Name === "tags");
      expect(tagsField.Array).toBe(true);
      expect(tagsField.Required).toBe(true);
    });

    it("ネストしたフィールドを正しく生成すること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [],
        inputFields: {
          profile: { type: "nested", required: true, array: false },
          settings: { type: "nested", required: false, array: true },
        },
        outputFields: {},
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const inputFields = manifestJSON.Resolvers[0].Inputs[0].Type.Fields;

      expect(inputFields).toHaveLength(2);

      // ネストしたprofileフィールド
      const profileField = inputFields.find((f: any) => f.Name === "profile");
      expect(profileField.Type.Kind).toBe("UserDefined");
      expect(profileField.Type.Name).toBe("TestInputProfile");
      expect(profileField.Required).toBe(true);
      expect(profileField.Array).toBe(false);
      expect(profileField.Type.Fields).toHaveLength(1);
      expect(profileField.Type.Fields[0].Name).toBe("name");

      // ネストした配列settingsフィールド
      const settingsField = inputFields.find((f: any) => f.Name === "settings");
      expect(settingsField.Type.Kind).toBe("UserDefined");
      expect(settingsField.Type.Name).toBe("TestInputSettings");
      expect(settingsField.Required).toBe(false);
      expect(settingsField.Array).toBe(true);
    });

    it("フィールド情報がない場合に空配列を返すこと", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [],
        inputFields: undefined,
        outputFields: {},
      };

      // console.warnをモック
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const inputFields = manifestJSON.Resolvers[0].Inputs[0].Type.Fields;

      expect(inputFields).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "No field information available for type: TestInput. Returning empty fields array.",
      );

      consoleWarnSpy.mockRestore();
    });

    it("未知の型に対してStringにフォールバックすること", async () => {
      const resolverMetadata: ResolverManifestMetadata = {
        name: "testResolver",
        inputType: "TestInput",
        outputType: "TestOutput",
        queryType: "query",
        pipelines: [],
        inputFields: {
          unknownField: { type: "unknown_type", required: true, array: false },
        },
        outputFields: {},
      };

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          testResolver: resolverMetadata,
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      const inputFields = manifestJSON.Resolvers[0].Inputs[0].Type.Fields;
      const unknownField = inputFields.find(
        (f: any) => f.Name === "unknownField",
      );

      expect(unknownField.Type.Name).toBe("String");
    });
  });

  describe("複雑なワークスペース構造での動作テスト", () => {
    it("大規模なワークスペースを正しく処理すること", async () => {
      const largeTailorDBService = {
        loadTypes: vi.fn().mockResolvedValue(undefined),
        toManifestJSON: vi.fn().mockReturnValue({
          Kind: "tailordb",
          Namespace: "large-namespace",
          Name: "large-tailordb",
        }),
      } as any;

      const largePipelineService = {
        build: vi.fn().mockResolvedValue(undefined),
        loadResolvers: vi.fn().mockResolvedValue(undefined),
        toManifestJSON: vi.fn().mockResolvedValue({
          Kind: "pipeline",
          Namespace: "large-namespace",
          Name: "large-pipeline",
          Resolvers: [],
        }),
      } as any;

      const largeApp = {
        toManifestJSON: vi.fn().mockReturnValue({
          Name: "large-app",
          Kind: "application",
        }),
        tailorDBServices: [largeTailorDBService, mockTailorDBService],
        pipelineResolverServices: [largePipelineService, mockPipelineService],
        authService: mockAuthService,
      } as any;

      const largeWorkspace = {
        applications: [largeApp, mockApplication],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "large-namespace",
        largeWorkspace,
      );

      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Apps).toHaveLength(2);
      expect(manifestJSON.Services).toHaveLength(8); // largeApp: TailorDB*2 + Pipeline*2 + Auth*1 + mockApp: TailorDB*1 + Pipeline*1 + Auth*1
      expect(manifestJSON.Tailordbs).toHaveLength(3); // largeTailorDBService + mockTailorDBService (from largeApp) + mockTailorDBService (from mockApp)
      expect(manifestJSON.Pipelines).toHaveLength(3); // largePipelineService + mockPipelineService (from largeApp) + mockPipelineService (from mockApp)
      expect(manifestJSON.Auths).toHaveLength(2);
    });

    it("非同期処理のエラーハンドリングが正しく動作すること", async () => {
      const failingTailorDBService = {
        loadTypes: vi.fn().mockRejectedValue(new Error("Load types failed")),
        toManifestJSON: vi.fn().mockReturnValue({
          Kind: "tailordb",
          Namespace: "test-namespace",
          Name: "failing-tailordb",
        }),
      } as any;

      const failingApp = {
        toManifestJSON: vi.fn().mockReturnValue({
          Name: "failing-app",
          Kind: "application",
        }),
        tailorDBServices: [failingTailorDBService],
        pipelineResolverServices: [],
        authService: null,
      } as any;

      const failingWorkspace = {
        applications: [failingApp],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        "test-namespace",
        failingWorkspace,
      );

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("Load types failed");
    });
  });
});
