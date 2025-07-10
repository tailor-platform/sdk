import { describe, it, expect, beforeEach, vi } from "vitest";
import { ManifestGenerator } from "./index";
import { db } from "@/services/tailordb/schema";
import {
  createQueryResolver,
  createMutationResolver,
} from "@/services/pipeline/resolver";
import type { Workspace } from "@/workspace";
import type { ApplyOptions } from "@/generator/options";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import t from "@/types/type";

// モックデータ - db.type を使用した正しい構造
const mockTailorDBType = db.type("User", {
  name: db.string().description("User name"),
  email: db.string().description("User email"),
  age: db.int().optional().description("User age"),
  profile: db
    .object({
      bio: db.string().optional(),
      avatar: db.string().optional(),
    })
    .description("User profile"),
  ...db.fields.timestamps,
});

const mockResolver = createQueryResolver(
  "getUser",
  t.type({
    id: t.string(),
    includeProfile: t.bool().optional(),
  }),
)
  .fnStep("fetchUser", async (context) => ({
    id: context.input.id,
    name: "Test User",
    email: "test@example.com",
  }))
  .sqlStep("validateUser", () => ({}) as any)
  .returns(
    (context) => ({
      id: context.fetchUser.id,
      name: context.fetchUser.name,
      email: context.fetchUser.email,
    }),
    t.type({
      id: t.string(),
      name: t.string(),
      email: t.string(),
    }),
  );

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
          getResolvers: vi.fn().mockReturnValue({}),
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

      // db.type を使用した場合、自動的に id フィールドが追加される
      expect(result.name).toBe("User");
      expect(result.isInput).toBe(false);
      expect(result.fields).toHaveLength(5); // id, name, email, age, profile

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
  });

  describe("複雑なデータ構造のテスト", () => {
    it("ネストしたフィールドを持つ型を正しく処理する", async () => {
      const nestedType = db.type("ComplexUser", {
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
      const complexResolver = createMutationResolver(
        "complexOperation",
        t.type({
          userId: t.string(),
          data: t.string(),
        }),
      )
        .fnStep("validateInput", async (_context) => ({ valid: true }))
        .sqlStep("updateDatabase", async () => ({ updated: true }))
        .gqlStep("notifyServices", ({ client, gql }) =>
          client.query(gql(`query { get { id } }`), {}),
        )
        .fnStep("finalizeOperation", async (_context) => ({
          success: true,
          message: "Operation completed successfully",
        }))
        .returns(
          (context) => ({
            success: context.finalizeOperation.success,
            message: context.finalizeOperation.message,
          }),
          t.type({
            success: t.bool(),
            message: t.string(),
          }),
        );

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
});
