import { describe, it, expect, beforeEach, vi } from "vitest";
import { ManifestGenerator } from "./index";
import type { TailorDBType } from "@/services/tailordb/schema";
import { db } from "@/services/tailordb/schema";
import type { Resolver } from "@/services/pipeline/resolver";
import type { Workspace } from "@/workspace";
import type { ApplyOptions } from "@/cli/args";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import path from "node:path";
import { getDistDir } from "@/config";

// モックデータ - db.type を使用した正しい構造
const mockTailorDBType: TailorDBType = db.type(
  "User",
  {
    name: db.string().description("User name"),
    email: db.string().description("User email"),
    age: db.int().optional().description("User age"),
    profile: db
      .object({
        bio: db.string().optional(),
        avatar: db.string().optional(),
      })
      .description("User profile"),
  },
  { withTimestamps: true },
);

const mockResolver: Resolver = {
  name: "getUser",
  queryType: "query",
  input: {
    fields: {
      id: { metadata: { type: "string", required: true } },
      includeProfile: { metadata: { type: "bool", required: false } },
    },
  },
  output: {
    fields: {
      id: { metadata: { type: "string", required: true } },
      name: { metadata: { type: "string", required: true } },
      email: { metadata: { type: "string", required: true } },
    },
  },
  steps: [
    ["fn", "fetchUser", {}, {}],
    ["sql", "validateUser", {}, {}],
  ],
  outputMapper: function (context: any) {
    return {
      id: context.fetchUser.id,
      name: context.fetchUser.name,
      email: context.fetchUser.email,
    };
  },
} as any;

const mockWorkspace: Workspace = {
  config: { name: "test-workspace", app: {}, generators: [] },
  applications: [
    {
      name: "test-app",
      tailorDBServices: [
        {
          loadTypes: vi.fn().mockResolvedValue({ User: mockTailorDBType }),
          toManifestJSON: vi.fn().mockReturnValue({
            Kind: "tailordb",
            Namespace: "test-db",
          }),
        },
      ],
      pipelineResolverServices: [
        {
          build: vi.fn().mockResolvedValue(undefined),
          loadResolvers: vi
            .fn()
            .mockImplementation(() => Promise.resolve(undefined)),
          toManifestJSON: vi.fn().mockResolvedValue({
            Kind: "pipeline",
            Namespace: "test-pipeline",
            Resolvers: [],
          }),
        },
      ],
      authService: {
        toManifest: vi.fn().mockImplementation(() => ({
          Kind: "auth",
          Namespace: "test-auth",
        })),
      },
      toManifestJSON: vi.fn().mockReturnValue({
        Kind: "application",
        Name: "test-app",
      }),
    },
  ],
} as any;

const mockApplyOptions: ApplyOptions = {
  dryRun: false,
};

describe("ManifestGenerator統合テスト", () => {
  let manifestGenerator: ManifestGenerator;

  beforeEach(() => {
    manifestGenerator = new ManifestGenerator(mockApplyOptions);
    manifestGenerator.workspace = mockWorkspace;
  });

  describe("基本的な動作テスト", () => {
    it("ManifestGeneratorクラスが正しく初期化される", () => {
      expect(manifestGenerator.id).toBe("@tailor/manifest");
      expect(manifestGenerator.description).toBe(
        "Generates Manifest JSON files for TailorDB types and resolvers",
      );
      expect(manifestGenerator.option).toBe(mockApplyOptions);
      expect(manifestGenerator.workspace).toBe(mockWorkspace);
    });

    it("processType メソッドが TailorDBType を正しく処理する", async () => {
      const result = await manifestGenerator.processType(mockTailorDBType);

      // db.type を使用した場合、自動的に id, createdAt, updatedAt フィールドが追加される
      expect(result.name).toBe("User");
      expect(result.isInput).toBe(false);
      expect(result.fields).toHaveLength(7); // id, name, email, age, profile, createdAt, updatedAt

      // 主要フィールドの確認
      const nameField = result.fields.find((f) => f.name === "name");
      expect(nameField).toEqual({
        name: "name",
        description: "User name",
        type: "string",
        required: true,
        array: false,
      });

      const profileField = result.fields.find((f) => f.name === "profile");
      expect(profileField?.name).toBe("profile");
      expect(profileField?.type).toBe("nested");
      expect(profileField?.required).toBe(true);
    });

    it("processResolver メソッドが Resolver を正しく処理する", async () => {
      const result = await manifestGenerator.processResolver(mockResolver);

      expect(result.name).toBe("getUser");
      expect(result.inputType).toBe("GetUserInput");
      expect(result.outputType).toBe("GetUserOutput");
      expect(result.queryType).toBe("query");
      expect(result.pipelines).toHaveLength(2);
      expect(result.pipelines[0]).toEqual({
        name: "fetchUser",
        description: "fetchUser",
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: "",
      });
      expect(result.pipelines[1]).toEqual({
        name: "validateUser",
        description: "validateUser",
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: "",
      });
      expect(result.outputMapper).toBeDefined();
    });
  });

  describe("aggregate関数のテスト", () => {
    it("ワークスペース全体のマニフェストを正しく生成する", async () => {
      const metadata = {
        types: {
          User: {
            name: "User",
            fields: [],
            isInput: false,
          },
        },
        resolvers: {
          getUser: {
            name: "getUser",
            inputType: "GetUserInput",
            outputType: "GetUserOutput",
            queryType: "query" as const,
            pipelines: [],
            inputFields: {
              id: { type: "string", required: true, array: false },
            },
            outputFields: {
              name: { type: "string", required: true, array: false },
            },
          },
        },
      };

      const result = await manifestGenerator.aggregate(metadata);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(
        path.join(getDistDir(), "manifest.cue"),
      );

      const manifestContent = JSON.parse(result.files[0].content);
      expect(manifestContent.Kind).toBe("workspace");
      expect(manifestContent.Apps).toBeDefined();
      expect(manifestContent.Services).toBeDefined();
      expect(manifestContent.Auths).toBeDefined();
      expect(manifestContent.Pipelines).toBeDefined();
      expect(manifestContent.Executors).toBeDefined();
      expect(manifestContent.Stateflows).toBeDefined();
      expect(manifestContent.Tailordbs).toBeDefined();
    });

    it("ワークスペースなしでPipelineマニフェストを生成する", async () => {
      const generatorWithoutWorkspace = new ManifestGenerator(mockApplyOptions);
      // workspace を設定しない

      const metadata = {
        types: {},
        resolvers: {
          getUser: {
            name: "getUser",
            inputType: "GetUserInput",
            outputType: "GetUserOutput",
            queryType: "query" as const,
            pipelines: [
              {
                name: "fetchUser",
                description: "Fetch user data",
                operationType: PipelineResolver_OperationType.FUNCTION,
                operationSource: "function code here",
              },
            ],
            inputFields: {
              id: { type: "string", required: true, array: false },
            },
            outputFields: {
              name: { type: "string", required: true, array: false },
              email: { type: "string", required: true, array: false },
            },
          },
        },
      };

      const result = await generatorWithoutWorkspace.aggregate(metadata);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(
        path.join(getDistDir(), "manifest.cue"),
      );

      const manifestContent = JSON.parse(result.files[0].content);
      expect(manifestContent.Kind).toBe("pipeline");
      expect(manifestContent.Namespace).toBe("default");
      expect(manifestContent.Resolvers).toHaveLength(1);
      expect(manifestContent.Resolvers[0].Name).toBe("getUser");
      expect(manifestContent.Resolvers[0].Pipelines).toHaveLength(2); // fetchUser + __construct_output
    });
  });

  describe("エラーハンドリングのテスト", () => {
    it("processType でエラーが発生した場合の処理", async () => {
      const invalidType = {
        ...mockTailorDBType,
        fields: null, // 無効なフィールド
      } as any;

      await expect(
        manifestGenerator.processType(invalidType),
      ).rejects.toThrow();
    });

    it("aggregate でnullリゾルバーが含まれても正常に処理すること", async () => {
      const metadataWithNullResolver = {
        types: {},
        resolvers: {
          invalid: null, // nullのリゾルバー
        },
      } as any;

      const generatorWithoutWorkspace = new ManifestGenerator(mockApplyOptions);
      const result = await generatorWithoutWorkspace.aggregate(
        metadataWithNullResolver,
      );

      // nullリゾルバーはスキップされ、マニフェストは正常に生成される
      expect(result.files).toHaveLength(1);
      expect(result.errors).toBeUndefined();

      const manifestContent = JSON.parse(result.files[0].content);
      expect(manifestContent.Resolvers).toHaveLength(0); // nullリゾルバーはスキップ
    });
  });

  describe("複雑なデータ構造のテスト", () => {
    it("ネストしたフィールドを持つ型を正しく処理する", async () => {
      const nestedType: TailorDBType = db.type("ComplexUser", {
        profile: db.object({
          personal: db.object({
            firstName: db.string(),
            lastName: db.string(),
          }),
          contact: db
            .object({
              email: db.string(),
              phone: db.string().optional(),
            })
            .optional(),
        }),
      });

      const result = await manifestGenerator.processType(nestedType);

      expect(result.name).toBe("ComplexUser");
      expect(result.fields).toHaveLength(2); // id, profile (withTimestamps: false by default)
      const profileField = result.fields.find((f) => f.name === "profile");
      expect(profileField?.name).toBe("profile");
      expect(profileField?.type).toBe("nested");

      const profileFields = (profileField as any).Fields;
      expect(profileFields.personal).toBeDefined();
      expect(profileFields.contact).toBeDefined();
      expect(profileFields.personal.Fields.firstName).toBeDefined();
      expect(profileFields.personal.Fields.lastName).toBeDefined();
      expect(profileFields.contact.Fields.email).toBeDefined();
      expect(profileFields.contact.Fields.phone).toBeDefined();
    });

    it("複数のパイプラインを持つリゾルバーを正しく処理する", async () => {
      const complexResolver: Resolver = {
        name: "complexOperation",
        queryType: "mutation",
        input: {
          fields: {
            userId: { metadata: { type: "string", required: true } },
            data: { metadata: { type: "string", required: true } },
          },
        },
        output: {
          fields: {
            success: { metadata: { type: "bool", required: true } },
            message: { metadata: { type: "string", required: true } },
          },
        },
        steps: [
          ["fn", "validateInput", {}, {}],
          ["sql", "updateDatabase", {}, {}],
          ["gql", "notifyServices", {}, {}],
          ["fn", "finalizeOperation", {}, {}],
        ],
        outputMapper: function (context: any) {
          return {
            success: context.finalizeOperation.success,
            message: context.finalizeOperation.message,
          };
        },
      } as any;

      const result = await manifestGenerator.processResolver(complexResolver);

      expect(result.name).toBe("complexOperation");
      expect(result.queryType).toBe("mutation");
      expect(result.pipelines).toHaveLength(4);
      expect(result.pipelines.map((p) => p.name)).toEqual([
        "validateInput",
        "updateDatabase",
        "notifyServices",
        "finalizeOperation",
      ]);
      expect(result.pipelines.map((p) => p.operationType)).toEqual([
        PipelineResolver_OperationType.FUNCTION,
        PipelineResolver_OperationType.FUNCTION,
        PipelineResolver_OperationType.GRAPHQL,
        PipelineResolver_OperationType.FUNCTION,
      ]);
    });
  });

  describe("パフォーマンステスト", () => {
    it("大量のデータを効率的に処理する", async () => {
      const startTime = Date.now();

      // 100個の型とリゾルバーでテスト
      const largeMetadata = {
        types: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [
            `Type${i}`,
            {
              name: `Type${i}`,
              fields: Array.from({ length: 10 }, (_, j) => ({
                name: `field${j}`,
                type: "string",
                required: true,
                array: false,
              })),
              isInput: false,
            },
          ]),
        ),
        resolvers: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [
            `resolver${i}`,
            {
              name: `resolver${i}`,
              inputType: `Resolver${i}Input`,
              outputType: `Resolver${i}Output`,
              queryType: "query" as const,
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
            },
          ]),
        ),
      };

      const result = await manifestGenerator.aggregate(largeMetadata);
      const endTime = Date.now();

      expect(result.files).toHaveLength(1);
      expect(endTime - startTime).toBeLessThan(5000); // 5秒以内で完了
    });
  });
});
