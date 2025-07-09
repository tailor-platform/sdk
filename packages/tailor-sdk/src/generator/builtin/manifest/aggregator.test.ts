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
      namespace: "test-namespace",
      loadTypes: vi.fn().mockResolvedValue(undefined),
      getTypes: vi.fn().mockReturnValue({
        "test-file.ts": {
          TestType: {
            name: "TestType",
            metadata: {
              name: "TestType",
              schema: {
                description: "Test type",
                fields: {
                  name: {
                    type: "string",
                    required: true,
                    description: "Name field",
                  },
                },
              },
            },
            fields: {
              name: {
                metadata: {
                  type: "string",
                  required: true,
                  description: "Name field",
                },
              },
            },
          },
        },
      }),
      toManifestJSON: vi.fn().mockReturnValue({
        Kind: "tailordb",
        Namespace: "test-namespace",
        Name: "test-tailordb",
      }),
    } as any;

    mockPipelineService = {
      namespace: "test-namespace",
      build: vi.fn().mockResolvedValue(undefined),
      loadResolvers: vi.fn().mockResolvedValue(undefined),
      getResolvers: vi.fn().mockReturnValue({}),
    } as any;

    mockAuthService = {
      toManifest: vi.fn().mockReturnValue({
        Kind: "auth",
        Namespace: "test-namespace",
        Name: "test-auth",
      }),
      config: {
        namespace: "test-namespace",
        idProviderConfigs: [
          {
            Name: "test-provider",
            Config: {
              Kind: "IDToken",
              Issuer: "test-issuer",
              Audience: "test-audience",
            },
          },
        ],
        userProfileProvider: "test-provider",
        userProfileProviderConfig: {},
        scimConfig: null,
        tenantProvider: "",
        tenantProviderConfig: null,
        machineUsers: [],
        oauth2Clients: [],
        version: "v2",
      },
    } as any;

    // モックアプリケーションの作成
    mockApplication = {
      name: "test-app",
      tailorDBServices: [mockTailorDBService],
      pipelineResolverServices: [mockPipelineService],
      authService: mockAuthService,
      subgraphs: [], // subgraphs プロパティを追加
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

      // ManifestAggregator.generatePipelineManifestのスパイを設定
      const generatePipelineManifestSpy = vi
        .spyOn(ManifestAggregator, "generatePipelineManifest")
        .mockResolvedValue({
          Kind: "pipeline",
          Namespace: "test-namespace",
          Resolvers: [],
          Version: "v2",
          Description: "",
        });

      const result = await ManifestAggregator.aggregate(
        metadata,
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

      generatePipelineManifestSpy.mockRestore();
    });

    it("エラーハンドリングが正しく動作すること", async () => {
      const errorWorkspace = {
        applications: [
          {
            name: "error-app",
            tailorDBServices: [],
            pipelineResolverServices: [],
            authService: null,
            subgraphs: [],
          },
        ],
      } as any;

      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {
          invalidResolver: {
            name: "invalidResolver",
            inputType: "InvalidInput",
            outputType: "InvalidOutput",
            queryType: "query",
            pipelines: [
              {
                name: "step1",
                description: "Step 1",
                operationType: PipelineResolver_OperationType.FUNCTION,
              },
            ],
            inputFields: undefined, // 無効な入力フィールド
            outputFields: undefined, // 無効な出力フィールド
          },
        },
      };

      const result = await ManifestAggregator.aggregate(
        metadata,
        errorWorkspace,
      );

      // エラーではなく、警告が発生するが、ファイルは生成される
      expect(result.files).toHaveLength(1);
      expect(result.errors).toBeUndefined();
    });
  });

  describe("generateWorkspaceManifest", () => {
    it("複数のアプリケーションを持つワークスペースを正しく処理すること", async () => {
      const secondApp = {
        name: "second-app",
        tailorDBServices: [],
        pipelineResolverServices: [],
        authService: null,
        subgraphs: [],
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

      // ManifestAggregator.generatePipelineManifestのスパイを設定
      const generatePipelineManifestSpy = vi
        .spyOn(ManifestAggregator, "generatePipelineManifest")
        .mockResolvedValue({
          Kind: "pipeline",
          Namespace: "test-namespace",
          Resolvers: [],
          Version: "v2",
          Description: "",
        });

      const result = await ManifestAggregator.aggregate(
        metadata,
        multiAppWorkspace,
      );

      expect(result.files).toHaveLength(1);
      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Apps).toHaveLength(2);
      expect(manifestJSON.Apps[0].Name).toBe("test-app");
      expect(manifestJSON.Apps[1].Name).toBe("second-app");

      generatePipelineManifestSpy.mockRestore();
    });

    it("Authサービスがnullの場合を正しく処理すること", async () => {
      const appWithoutAuth = {
        name: "app-without-auth",
        tailorDBServices: [mockTailorDBService],
        pipelineResolverServices: [mockPipelineService],
        authService: null,
        subgraphs: [],
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

      // ManifestAggregator.generatePipelineManifestのスパイを設定
      const generatePipelineManifestSpy = vi
        .spyOn(ManifestAggregator, "generatePipelineManifest")
        .mockResolvedValue({
          Kind: "pipeline",
          Namespace: "test-namespace",
          Resolvers: [],
          Version: "v2",
          Description: "",
        });

      const result = await ManifestAggregator.aggregate(
        metadata,
        workspaceWithoutAuth,
      );

      expect(result.files).toHaveLength(1);
      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Auths).toHaveLength(0);
      expect(manifestJSON.Services).toHaveLength(2); // TailorDB + Pipeline のみ

      generatePipelineManifestSpy.mockRestore();
    });

    it("各サービスのメソッドが正しく呼ばれること", async () => {
      const metadata: BasicGeneratorMetadata<
        ManifestTypeMetadata,
        ResolverManifestMetadata
      > = {
        types: {},
        resolvers: {},
      };

      // ManifestAggregator.generatePipelineManifestのスパイを設定
      const generatePipelineManifestSpy = vi
        .spyOn(ManifestAggregator, "generatePipelineManifest")
        .mockResolvedValue({
          Kind: "pipeline",
          Namespace: "test-namespace",
          Resolvers: [],
          Version: "v2",
          Description: "",
        });

      await ManifestAggregator.aggregate(metadata, mockWorkspace);

      // TailorDBサービスの検証
      expect(mockTailorDBService.loadTypes).toHaveBeenCalledTimes(1);

      // Pipelineサービスの検証
      expect(mockPipelineService.build).toHaveBeenCalledTimes(1);
      expect(mockPipelineService.loadResolvers).toHaveBeenCalledTimes(1);

      // ManifestAggregator.generatePipelineManifestが呼び出されたことを確認
      expect(generatePipelineManifestSpy).toHaveBeenCalledTimes(1);

      generatePipelineManifestSpy.mockRestore();
    });
  });

  describe("複雑なワークスペース構造での動作テスト", () => {
    it("大規模なワークスペースを正しく処理すること", async () => {
      const largeTailorDBService = {
        namespace: "large-namespace",
        loadTypes: vi.fn().mockResolvedValue(undefined),
        getTypes: vi.fn().mockReturnValue({
          "large-file.ts": {
            LargeType: {
              name: "LargeType",
              metadata: {
                name: "LargeType",
                schema: {
                  description: "Large type",
                  fields: {
                    data: {
                      type: "string",
                      required: true,
                      description: "Data field",
                    },
                  },
                },
              },
              fields: {
                data: {
                  metadata: {
                    type: "string",
                    required: true,
                    description: "Data field",
                  },
                },
              },
            },
          },
        }),
        toManifestJSON: vi.fn().mockReturnValue({
          Kind: "tailordb",
          Namespace: "large-namespace",
          Name: "large-tailordb",
        }),
      } as any;

      const largePipelineService = {
        namespace: "large-namespace",
        build: vi.fn().mockResolvedValue(undefined),
        loadResolvers: vi.fn().mockResolvedValue(undefined),
        getResolvers: vi.fn().mockReturnValue({}),
      } as any;

      const largeApp = {
        name: "large-app",
        tailorDBServices: [largeTailorDBService, mockTailorDBService],
        pipelineResolverServices: [largePipelineService, mockPipelineService],
        authService: mockAuthService,
        subgraphs: [],
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

      // ManifestAggregator.generatePipelineManifestのスパイを設定
      const generatePipelineManifestSpy = vi
        .spyOn(ManifestAggregator, "generatePipelineManifest")
        .mockResolvedValue({
          Kind: "pipeline",
          Namespace: "large-namespace",
          Resolvers: [],
          Version: "v2",
          Description: "",
        });

      const result = await ManifestAggregator.aggregate(
        metadata,
        largeWorkspace,
      );

      expect(result.files).toHaveLength(1);
      const manifestJSON = JSON.parse(result.files[0].content);
      expect(manifestJSON.Apps).toHaveLength(2);
      expect(manifestJSON.Services).toHaveLength(8); // largeApp: TailorDB*2 + Pipeline*2 + Auth*1 + mockApp: TailorDB*1 + Pipeline*1 + Auth*1
      expect(manifestJSON.Tailordbs).toHaveLength(3); // largeTailorDBService + mockTailorDBService (from largeApp) + mockTailorDBService (from mockApp)
      expect(manifestJSON.Pipelines).toHaveLength(3); // largePipelineService + mockPipelineService (from largeApp) + mockPipelineService (from mockApp)
      expect(manifestJSON.Auths).toHaveLength(2);

      generatePipelineManifestSpy.mockRestore();
    });

    it("非同期処理のエラーハンドリングが正しく動作すること", async () => {
      const failingTailorDBService = {
        namespace: "test-namespace",
        loadTypes: vi.fn().mockRejectedValue(new Error("Load types failed")),
        getTypes: vi.fn().mockReturnValue({}),
        toManifestJSON: vi.fn().mockReturnValue({
          Kind: "tailordb",
          Namespace: "test-namespace",
          Name: "failing-tailordb",
        }),
      } as any;

      const failingApp = {
        name: "failing-app",
        tailorDBServices: [failingTailorDBService],
        pipelineResolverServices: [],
        authService: null,
        subgraphs: [],
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
        failingWorkspace,
      );

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("Load types failed");
    });
  });
});
