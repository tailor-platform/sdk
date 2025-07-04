import { describe, it, expect, beforeEach } from "vitest";
import { SdlGenerator, SdlGeneratorID } from "./index";
import { db } from "@/services/tailordb/schema";
import {
  createQueryResolver,
  createMutationResolver,
} from "@/services/pipeline/resolver";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import path from "node:path";
import { t } from "@/types";

const userType = db.type("User", {
  name: db.string().description("User name"),
  email: db.string().description("User email"),
  age: db.int().optional(),
  isActive: db.bool(),
  tags: db.string().array(),
  profile: db
    .object({
      bio: db.string().optional(),
      avatar: db.string().optional(),
    })
    .optional(),
});

const mockResolver = createQueryResolver(
  "getUser",
  t.type({
    id: t.string(),
    includeProfile: t.bool().optional(),
  }),
)
  .fnStep("fetchUser", (context) => ({
    id: context.input.id,
    name: "John Doe",
    email: "john@example.com",
    age: 30,
  }))
  .sqlStep("validateUser", async () => "SELECT 1")
  .returns(
    (context) => ({
      id: context.fetchUser.id,
      name: context.fetchUser.name,
      email: context.fetchUser.email,
      age: context.fetchUser.age ?? undefined,
    }),
    t.type({
      id: t.string(),
      name: t.string(),
      email: t.string(),
      age: t.int().optional(),
      age2: t.int().optional(),
    }),
  );

const mockMutationResolver = createMutationResolver(
  "createUser",
  t.type({
    name: t.string(),
    email: t.string(),
    age: t.int().optional(),
  }),
)
  .fnStep("validateInput", (context) => ({
    valid: true,
    input: context.input,
  }))
  .sqlStep("insertUser", async () => ({ id: "user-123" }))
  .gqlStep("notifyServices", ({ gql, client }) =>
    client.mutation(
      gql(`
      mutation NotifyServices {
        notify {
          notified
        }
      }
    `),
      {},
    ),
  )
  .returns(
    (context) => ({
      id: context.insertUser.id,
      success: true,
    }),
    t.type({
      id: t.string(),
      success: t.bool(),
    }),
  );

const complexType = db.type("ComplexEntity", {
  metadata: db.object({
    tags: db.string().array(),
    settings: db
      .object({
        theme: db.string(),
        notifications: db.bool().optional(),
      })
      .optional(),
  }),
});

describe("SdlGenerator統合テスト", () => {
  let sdlGenerator: SdlGenerator;

  beforeEach(() => {
    sdlGenerator = new SdlGenerator();
  });

  describe("基本的な動作テスト", () => {
    it("SdlGeneratorクラスが正しく初期化される", () => {
      expect(sdlGenerator.id).toBe(SdlGeneratorID);
      expect(sdlGenerator.description).toBe(
        "Generates SDL files for TailorDB types and resolvers",
      );
    });

    it("processType メソッドが TailorDBType を正しくSDLTypeMetadataに変換する", async () => {
      const result = await sdlGenerator.processType(userType);

      expect(result.name).toBe("User");
      expect(result.isInput).toBe(false);
      expect(result.fields).toHaveLength(7); // id + 6 defined fields

      // 基本フィールドの確認
      const nameField = result.fields.find((f) => f.name === "name");
      expect(nameField).toEqual({
        name: "name",
        type: "String",
        required: true,
        array: false,
      });

      const emailField = result.fields.find((f) => f.name === "email");
      expect(emailField).toEqual({
        name: "email",
        type: "String",
        required: true,
        array: false,
      });

      const ageField = result.fields.find((f) => f.name === "age");
      expect(ageField).toEqual({
        name: "age",
        type: "Int",
        required: false,
        array: false,
      });

      const isActiveField = result.fields.find((f) => f.name === "isActive");
      expect(isActiveField).toEqual({
        name: "isActive",
        type: "Boolean",
        required: true,
        array: false,
      });

      // 配列フィールドの確認
      const tagsField = result.fields.find((f) => f.name === "tags");
      expect(tagsField).toEqual({
        name: "tags",
        type: "String",
        required: true,
        array: true,
      });

      // ネストしたフィールドの確認
      const profileField = result.fields.find((f) => f.name === "profile");
      expect(profileField?.name).toBe("profile");
      expect(profileField?.required).toBe(false);
      expect(profileField?.array).toBe(false);
      expect(profileField?.type).toContain("{");
      expect(profileField?.type).toContain("bio: String");
      expect(profileField?.type).toContain("avatar: String");
    });

    it("processResolver メソッドが Resolver を正しくSDLに変換する", async () => {
      const result = await sdlGenerator.processResolver(mockResolver);

      expect(result.name).toBe("getUser");
      expect(result.inputType).toBe("GetUserInput");
      expect(result.outputType).toBe("GetUserOutput");
      expect(result.queryType).toBe("query");

      // SDLの内容を確認
      expect(result.sdl).toContain("input GetUserInput {");
      expect(result.sdl).toContain("type GetUserOutput {");
      expect(result.sdl).toContain("extend type Query {");
      expect(result.sdl).toContain(
        "getUser(input: GetUserInput): GetUserOutput",
      );

      // パイプライン情報の確認
      expect(result.pipelines).toHaveLength(2);
      expect(result.pipelines[0]).toEqual({
        name: "fetchUser",
        description: "fetchUser",
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: "",
        operationName: "fetchUser",
      });
      expect(result.pipelines[1]).toEqual({
        name: "validateUser",
        description: "validateUser",
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: "",
        operationName: "validateUser",
      });
    });

    it("mutation Resolver を正しく処理する", async () => {
      const result = await sdlGenerator.processResolver(mockMutationResolver);

      expect(result.name).toBe("createUser");
      expect(result.queryType).toBe("mutation");
      expect(result.sdl).toContain("extend type Mutation {");
      expect(result.sdl).toContain(
        "createUser(input: CreateUserInput): CreateUserOutput",
      );

      // GraphQLステップの確認
      expect(result.pipelines).toHaveLength(3);
      expect(result.pipelines[2]).toEqual({
        name: "notifyServices",
        description: "notifyServices",
        operationType: PipelineResolver_OperationType.GRAPHQL,
        operationSource: "",
        operationName: "notifyServices",
      });
    });
  });

  describe("aggregate関数のテスト", () => {
    it("型とリゾルバーのメタデータを統合してSDLファイルを生成する", () => {
      const metadata = {
        types: {
          User: {
            name: "User",
            fields: [
              { name: "id", type: "ID", required: true, array: false },
              { name: "name", type: "String", required: true, array: false },
              { name: "email", type: "String", required: true, array: false },
            ],
            isInput: false,
          },
          Post: {
            name: "Post",
            fields: [
              { name: "id", type: "ID", required: true, array: false },
              { name: "title", type: "String", required: true, array: false },
              {
                name: "content",
                type: "String",
                required: false,
                array: false,
              },
            ],
            isInput: false,
          },
        },
        resolvers: {
          getUser: {
            name: "getUser",
            sdl: `input GetUserInput {
  id: ID!
}

type GetUserOutput {
  id: ID!
  name: String!
  email: String!
}

extend type Query {
  getUser(input: GetUserInput): GetUserOutput
}`,
            inputType: "GetUserInput",
            outputType: "GetUserOutput",
            queryType: "query" as const,
            pipelines: [],
          },
          createPost: {
            name: "createPost",
            sdl: `input CreatePostInput {
  title: String!
  content: String
}

type CreatePostOutput {
  id: ID!
  success: Boolean!
}

extend type Mutation {
  createPost(input: CreatePostInput): CreatePostOutput
}`,
            inputType: "CreatePostInput",
            outputType: "CreatePostOutput",
            queryType: "mutation" as const,
            pipelines: [],
          },
        },
      };

      const baseDir = "/test/output";
      const result = sdlGenerator.aggregate(metadata, baseDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(path.join(baseDir, "schema.graphql"));
      expect(result.errors).toBeUndefined();

      const content = result.files[0].content;

      // TailorDB型のSDLコメントと内容の確認
      expect(content).toContain("# Type: User");
      expect(content).toContain("type User {");
      expect(content).toContain("id: ID!");
      expect(content).toContain("name: String!");
      expect(content).toContain("email: String!");

      expect(content).toContain("# Type: Post");
      expect(content).toContain("type Post {");
      expect(content).toContain("title: String!");
      expect(content).toContain("content: String");

      // Resolver SDLコメントと内容の確認
      expect(content).toContain("# Resolver: getUser");
      expect(content).toContain("input GetUserInput {");
      expect(content).toContain("type GetUserOutput {");
      expect(content).toContain("extend type Query {");

      expect(content).toContain("# Resolver: createPost");
      expect(content).toContain("input CreatePostInput {");
      expect(content).toContain("type CreatePostOutput {");
      expect(content).toContain("extend type Mutation {");

      // ファイル末尾に改行が2つある
      expect(content.endsWith("\n\n")).toBe(true);
    });

    it("空のメタデータでも正常に動作する", () => {
      const metadata = {
        types: {},
        resolvers: {},
      };

      const result = sdlGenerator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe("\n\n");
    });
  });

  describe("複雑なデータ構造のテスト", () => {
    it("深くネストしたオブジェクトを正しくSDLに変換する", async () => {
      const result = await sdlGenerator.processType(complexType);

      expect(result.name).toBe("ComplexEntity");
      expect(result.fields).toHaveLength(2); // id + metadata

      const metadataField = result.fields.find((f) => f.name === "metadata");
      expect(metadataField).toBeDefined();
      expect(metadataField?.name).toBe("metadata");
      expect(metadataField?.required).toBe(true);
      expect(metadataField?.type).toContain("{");
      expect(metadataField?.type).toContain("tags: [String!]!");
      expect(metadataField?.type).toContain("settings: {");
      expect(metadataField?.type).toContain("theme: String!");
      expect(metadataField?.type).toContain("notifications: Boolean");
    });

    it("複数のステップを持つリゾルバーを正しく処理する", async () => {
      const complexResolver = createMutationResolver(
        "complexOperation",
        t.type({
          data: t.string(),
          options: t.string().array().optional(),
        }),
      )
        .fnStep("validateInput", (context) => ({
          valid: true,
          data: context.input.data,
        }))
        .sqlStep("processData", async () => ({ processed: true }))
        .gqlStep("fetchAdditionalData", ({ gql, client }) =>
          client.query(
            gql(`
            query FetchAdditionalData {
              fetchData {
                additional
              }
            }
          `),
            {},
          ),
        )
        .fnStep("combineResults", (context) => ({
          final: true,
          all: context,
        }))
        .returns(
          (_context) => ({
            result: "combined",
            metadata: "metadata",
          }),
          t.type({
            result: t.string(),
            metadata: t.string(),
          }),
        );

      const result = await sdlGenerator.processResolver(complexResolver);

      expect(result.pipelines).toHaveLength(4);
      expect(result.pipelines.map((p: any) => p.name)).toEqual([
        "validateInput",
        "processData",
        "fetchAdditionalData",
        "combineResults",
      ]);
      expect(result.pipelines.map((p: any) => p.operationType)).toEqual([
        PipelineResolver_OperationType.FUNCTION,
        PipelineResolver_OperationType.FUNCTION,
        PipelineResolver_OperationType.GRAPHQL,
        PipelineResolver_OperationType.FUNCTION,
      ]);

      expect(result.sdl).toContain("input ComplexOperationInput {");
      expect(result.sdl).toContain("data: String!");
      expect(result.sdl).toContain("options: [String!]");
      expect(result.sdl).toContain("type ComplexOperationOutput {");
      expect(result.sdl).toContain("result: String!");
      expect(result.sdl).toContain("metadata: String");
      expect(result.sdl).toContain("extend type Mutation {");
    });
  });

  describe("エラーハンドリングのテスト", () => {
    it("output型が定義されていないリゾルバーでエラーが発生する", async () => {
      const invalidResolver = createQueryResolver(
        "getUser",
        t.type({
          id: t.string(),
          includeProfile: t.bool().optional(),
        }),
      );

      await expect(
        sdlGenerator.processResolver(invalidResolver),
      ).rejects.toThrow('Resolver "getUser" must have an output type defined');
    });

    it("aggregate でエラーが発生した場合にエラー情報を返す", () => {
      const invalidMetadata = {
        types: {
          invalid: null, // 無効な型
        },
        resolvers: {},
      } as any;

      const result = sdlGenerator.aggregate(invalidMetadata, "/test/output");

      expect(result.files).toHaveLength(0);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe("完全な統合テスト", () => {
    it("実際のTailorDBTypeとResolverを使った完全な統合テスト", async () => {
      // 実際の型を処理
      const userTypeMetadata = await sdlGenerator.processType(userType);
      const complexTypeMetadata = await sdlGenerator.processType(complexType);

      // 実際のリゾルバーを処理
      const getUserResolverMetadata =
        await sdlGenerator.processResolver(mockResolver);
      const createUserResolverMetadata =
        await sdlGenerator.processResolver(mockMutationResolver);

      // 統合
      const metadata = {
        types: {
          User: userTypeMetadata,
          ComplexEntity: complexTypeMetadata,
        },
        resolvers: {
          getUser: getUserResolverMetadata,
          createUser: createUserResolverMetadata,
        },
      };

      const result = sdlGenerator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.errors).toBeUndefined();

      const content = result.files[0].content;

      // 全ての型が含まれている
      expect(content).toContain("# Type: User");
      expect(content).toContain("# Type: ComplexEntity");
      expect(content).toContain("type User {");
      expect(content).toContain("type ComplexEntity {");

      // 全てのリゾルバーが含まれている
      expect(content).toContain("# Resolver: getUser");
      expect(content).toContain("# Resolver: createUser");
      expect(content).toContain("extend type Query {");
      expect(content).toContain("extend type Mutation {");

      // ネストしたフィールドが正しく含まれている
      expect(content).toContain("profile: {");
      expect(content).toContain("bio: String");
      expect(content).toContain("avatar: String");
    });
  });
});
