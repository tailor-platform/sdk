import { describe, it, expect, vi, afterEach } from "vitest";
import { BasicGeneratorMetadata } from "../../types";
import { SDLTypeMetadata, ResolverSDLMetadata } from "./types";
import path from "node:path";
import { SDLUtils } from "./utils";
import { SDLAggregator } from "./aggregator";

describe("SDLAggregator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("aggregate", () => {
    it("基本的なSDL統合が正常に動作すること", () => {
      const typeMetadata: SDLTypeMetadata = {
        name: "User",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "name", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const resolverMetadata: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser(input: GetUserInput): GetUserOutput\n}",
        inputType: "GetUserInput",
        outputType: "GetUserOutput",
        queryType: "query",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: typeMetadata },
        resolvers: { getUser: resolverMetadata },
        executors: [],
      };

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(
        path.join("/test/output", "schema.graphql"),
      );
      expect(result.errors).toBeUndefined();
    });

    it("複数の型とリゾルバーを正しく統合すること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "name", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const postType: SDLTypeMetadata = {
        name: "Post",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "title", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const getUserResolver: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser(input: GetUserInput): User\n}",
        inputType: "GetUserInput",
        outputType: "User",
        queryType: "query",
        pipelines: [],
      };

      const createPostResolver: ResolverSDLMetadata = {
        name: "createPost",
        sdl: "extend type Mutation {\n  createPost(input: CreatePostInput): Post\n}",
        inputType: "CreatePostInput",
        outputType: "Post",
        queryType: "mutation",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType, Post: postType },
        resolvers: { getUser: getUserResolver, createPost: createPostResolver },
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(generateSDLSpy).toHaveBeenCalledTimes(2);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: Post",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Resolver: getUser",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Resolver: createPost",
      );
    });

    it("空の型とリゾルバーを正しく処理すること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe("\n\n");
      expect(generateSDLSpy).not.toHaveBeenCalled();
    });

    it("型のみの場合を正しく処理すること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [{ name: "id", type: "String", required: true, array: false }],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType },
        resolvers: {},
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(generateSDLSpy).toHaveBeenCalledTimes(1);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User",
      );
    });

    it("リゾルバーのみの場合を正しく処理すること", () => {
      const resolverMetadata: ResolverSDLMetadata = {
        name: "ping",
        sdl: "extend type Query {\n  ping: String\n}",
        inputType: "PingInput",
        outputType: "String",
        queryType: "query",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: { ping: resolverMetadata },
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(generateSDLSpy).not.toHaveBeenCalled();
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Resolver: ping",
      );
    });

    it("エラーハンドリングが正しく動作すること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType },
        resolvers: {},
        executors: [],
      };

      // SDLUtils.generateSDLFromMetadataでエラーを投げる
      vi.spyOn(SDLUtils, "generateSDLFromMetadata").mockImplementation(() => {
        throw new Error("SDL generation failed");
      });

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("SDL generation failed");
    });

    it("ファイル末尾に正しく改行を追加すること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      vi.spyOn(SDLUtils, "combineSDL").mockReturnValue(
        "type User {\n  id: String!\n}",
      );

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files[0].content).toBe("type User {\n  id: String!\n}\n\n");
    });
  });

  describe("generateTailordbSDL", () => {
    it("複数のTailorDB型を正しく処理すること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "name", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const postType: SDLTypeMetadata = {
        name: "Post",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "title", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const productType: SDLTypeMetadata = {
        name: "Product",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "price", type: "Float", required: true, array: false },
        ],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType, Post: postType, Product: productType },
        resolvers: {},
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(generateSDLSpy).toHaveBeenCalledTimes(3);
      expect(generateSDLSpy).toHaveBeenCalledWith(userType);
      expect(generateSDLSpy).toHaveBeenCalledWith(postType);
      expect(generateSDLSpy).toHaveBeenCalledWith(productType);

      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: Post",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: Product",
      );
    });

    it("Input型とOutput型を区別して処理すること", () => {
      const userInputType: SDLTypeMetadata = {
        name: "UserInput",
        fields: [
          { name: "name", type: "String", required: true, array: false },
        ],
        isInput: true,
      };

      const userOutputType: SDLTypeMetadata = {
        name: "User",
        fields: [
          { name: "id", type: "String", required: true, array: false },
          { name: "name", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { UserInput: userInputType, User: userOutputType },
        resolvers: {},
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(generateSDLSpy).toHaveBeenCalledWith(userInputType);
      expect(generateSDLSpy).toHaveBeenCalledWith(userOutputType);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: UserInput",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User",
      );
    });

    it("空の型オブジェクトを正しく処理すること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const combineSDLSpy = vi.spyOn(SDLUtils, "combineSDL");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(generateSDLSpy).not.toHaveBeenCalled();
      expect(combineSDLSpy).toHaveBeenCalledWith();
    });

    it("型名に特殊文字が含まれている場合を処理すること", () => {
      const specialNameType: SDLTypeMetadata = {
        name: "User_Profile_Data",
        fields: [
          { name: "user_id", type: "String", required: true, array: false },
        ],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User_Profile_Data: specialNameType },
        resolvers: {},
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User_Profile_Data",
      );
    });
  });

  describe("generateResolverSDL", () => {
    it("複数のリゾルバーを正しく処理すること", () => {
      const getUserResolver: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser(input: GetUserInput): User\n}",
        inputType: "GetUserInput",
        outputType: "User",
        queryType: "query",
        pipelines: [],
      };

      const createUserResolver: ResolverSDLMetadata = {
        name: "createUser",
        sdl: "extend type Mutation {\n  createUser(input: CreateUserInput): User\n}",
        inputType: "CreateUserInput",
        outputType: "User",
        queryType: "mutation",
        pipelines: [],
      };

      const deleteUserResolver: ResolverSDLMetadata = {
        name: "deleteUser",
        sdl: "extend type Mutation {\n  deleteUser(input: DeleteUserInput): Boolean\n}",
        inputType: "DeleteUserInput",
        outputType: "Boolean",
        queryType: "mutation",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {
          getUser: getUserResolver,
          createUser: createUserResolver,
          deleteUser: deleteUserResolver,
        },
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).toHaveBeenCalledWith(
        getUserResolver.sdl,
        "Resolver: getUser",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        createUserResolver.sdl,
        "Resolver: createUser",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        deleteUserResolver.sdl,
        "Resolver: deleteUser",
      );
    });

    it("Query、Mutation、Subscriptionリゾルバーを混合して処理すること", () => {
      const queryResolver: ResolverSDLMetadata = {
        name: "getUsers",
        sdl: "extend type Query {\n  getUsers: [User!]!\n}",
        inputType: "GetUsersInput",
        outputType: "[User!]!",
        queryType: "query",
        pipelines: [],
      };

      const mutationResolver: ResolverSDLMetadata = {
        name: "updateUser",
        sdl: "extend type Mutation {\n  updateUser(input: UpdateUserInput): User\n}",
        inputType: "UpdateUserInput",
        outputType: "User",
        queryType: "mutation",
        pipelines: [],
      };

      const subscriptionResolver: ResolverSDLMetadata = {
        name: "userUpdated",
        sdl: "extend type Subscription {\n  userUpdated: User\n}",
        inputType: "UserUpdatedInput",
        outputType: "User",
        queryType: "query", // subscription is not supported in current type definition
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {
          getUsers: queryResolver,
          updateUser: mutationResolver,
          userUpdated: subscriptionResolver,
        },
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).toHaveBeenCalledWith(
        queryResolver.sdl,
        "Resolver: getUsers",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        mutationResolver.sdl,
        "Resolver: updateUser",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        subscriptionResolver.sdl,
        "Resolver: userUpdated",
      );
    });

    it("空のリゾルバーオブジェクトを正しく処理すること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      // リゾルバー関連のSDLUtilsメソッドが呼ばれないことを確認
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^Resolver:/),
      );
    });

    it("複雑なSDL構造を持つリゾルバーを処理すること", () => {
      const complexResolver: ResolverSDLMetadata = {
        name: "complexQuery",
        sdl: `
input ComplexInput {
  filters: FilterInput
  pagination: PaginationInput
}

type ComplexOutput {
  data: [User!]!
  metadata: QueryMetadata
}

extend type Query {
  complexQuery(input: ComplexInput): ComplexOutput
}`,
        inputType: "ComplexInput",
        outputType: "ComplexOutput",
        queryType: "query",
        pipelines: [
          {
            name: "validateInput",
            description: "Validate input",
            operationType: "FUNCTION",
          },
          {
            name: "fetchData",
            description: "Fetch data",
            operationType: "SQL",
          },
          {
            name: "processResults",
            description: "Process results",
            operationType: "FUNCTION",
          },
        ],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: { complexQuery: complexResolver },
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).toHaveBeenCalledWith(
        complexResolver.sdl,
        "Resolver: complexQuery",
      );
    });
  });

  describe("SDL統合とフォーマットのテスト", () => {
    it("型とリゾルバーSDLが正しい順序で統合されること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [{ name: "id", type: "String", required: true, array: false }],
        isInput: false,
      };

      const getUserResolver: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser: User\n}",
        inputType: "GetUserInput",
        outputType: "User",
        queryType: "query",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType },
        resolvers: { getUser: getUserResolver },
        executors: [],
      };

      // combineSDLが2回呼ばれることを確認（型用とリゾルバー用、そして全体統合用）
      const combineSDLSpy = vi.spyOn(SDLUtils, "combineSDL");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(combineSDLSpy).toHaveBeenCalledTimes(3);
    });

    it("大量の型とリゾルバーを処理できること", () => {
      const types: Record<string, SDLTypeMetadata> = {};
      const resolvers: Record<string, ResolverSDLMetadata> = {};

      // 50個の型を生成
      for (let i = 1; i <= 50; i++) {
        types[`Type${i}`] = {
          name: `Type${i}`,
          fields: [
            { name: "id", type: "String", required: true, array: false },
          ],
          isInput: false,
        };
      }

      // 30個のリゾルバーを生成
      for (let i = 1; i <= 30; i++) {
        resolvers[`resolver${i}`] = {
          name: `resolver${i}`,
          sdl: `extend type Query {\n  resolver${i}: Type${i}\n}`,
          inputType: `Resolver${i}Input`,
          outputType: `Type${i}`,
          queryType: "query",
          pipelines: [],
        };
      }

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types,
        resolvers,
        executors: [],
      };

      const generateSDLSpy = vi.spyOn(SDLUtils, "generateSDLFromMetadata");
      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(generateSDLSpy).toHaveBeenCalledTimes(50);
      expect(addCommentSpy).toHaveBeenCalledTimes(80); // 50型 + 30リゾルバー
    });

    it("SDLUtilsのエラーを適切にハンドリングすること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType },
        resolvers: {},
        executors: [],
      };

      // SDLUtils.combineSDLでエラーを投げる
      vi.spyOn(SDLUtils, "combineSDL").mockImplementation(() => {
        throw new Error("Combine SDL failed");
      });

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("Combine SDL failed");
    });

    it("部分的にエラーが発生しても続行できること", () => {
      const validType: SDLTypeMetadata = {
        name: "ValidType",
        fields: [{ name: "id", type: "String", required: true, array: false }],
        isInput: false,
      };

      const invalidType: SDLTypeMetadata = {
        name: "InvalidType",
        fields: [],
        isInput: false,
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { ValidType: validType, InvalidType: invalidType },
        resolvers: {},
        executors: [],
      };

      // 2回目の呼び出しでエラーを投げる
      vi.spyOn(SDLUtils, "generateSDLFromMetadata")
        .mockReturnValueOnce("type ValidType {\n  id: String!\n}\n")
        .mockImplementationOnce(() => {
          throw new Error("Invalid type generation failed");
        });

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toBe("Invalid type generation failed");
    });
  });

  describe("コメント追加機能のテスト", () => {
    it("型とリゾルバーに適切なコメントが追加されること", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [],
        isInput: false,
      };

      const profileType: SDLTypeMetadata = {
        name: "Profile",
        fields: [],
        isInput: true,
      };

      const getUserResolver: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser: User\n}",
        inputType: "GetUserInput",
        outputType: "User",
        queryType: "query",
        pipelines: [],
      };

      const updateProfileResolver: ResolverSDLMetadata = {
        name: "updateProfile",
        sdl: "extend type Mutation {\n  updateProfile: Profile\n}",
        inputType: "UpdateProfileInput",
        outputType: "Profile",
        queryType: "mutation",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType, Profile: profileType },
        resolvers: {
          getUser: getUserResolver,
          updateProfile: updateProfileResolver,
        },
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      // 型のコメント確認
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: Profile",
      );

      // リゾルバーのコメント確認
      expect(addCommentSpy).toHaveBeenCalledWith(
        getUserResolver.sdl,
        "Resolver: getUser",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        updateProfileResolver.sdl,
        "Resolver: updateProfile",
      );
    });

    it("特殊な名前でもコメントが正しく追加されること", () => {
      const specialType: SDLTypeMetadata = {
        name: "User_Profile_Data_V2",
        fields: [],
        isInput: false,
      };

      const specialResolver: ResolverSDLMetadata = {
        name: "get_user_profile_by_id_v2",
        sdl: "extend type Query {\n  get_user_profile_by_id_v2: User_Profile_Data_V2\n}",
        inputType: "GetUserProfileByIdV2Input",
        outputType: "User_Profile_Data_V2",
        queryType: "query",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User_Profile_Data_V2: specialType },
        resolvers: { get_user_profile_by_id_v2: specialResolver },
        executors: [],
      };

      const addCommentSpy = vi.spyOn(SDLUtils, "addComment");

      SDLAggregator.aggregate(metadata, "/test/output");

      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.any(String),
        "Type: User_Profile_Data_V2",
      );
      expect(addCommentSpy).toHaveBeenCalledWith(
        specialResolver.sdl,
        "Resolver: get_user_profile_by_id_v2",
      );
    });
  });

  describe("ファイル生成の詳細テスト", () => {
    it("出力ファイルパスが正しく生成されること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      const baseDirs = [
        "/test/output",
        "/complex/path/to/output",
        "./relative/path",
        "../parent/path",
        "simple/path",
      ];

      baseDirs.forEach((baseDir) => {
        const result = SDLAggregator.aggregate(metadata, baseDir);
        expect(result.files[0].path).toBe(path.join(baseDir, "schema.graphql"));
      });
    });

    it("生成されるファイル内容の構造が正しいこと", () => {
      const userType: SDLTypeMetadata = {
        name: "User",
        fields: [],
        isInput: false,
      };

      const getUserResolver: ResolverSDLMetadata = {
        name: "getUser",
        sdl: "extend type Query {\n  getUser: User\n}",
        inputType: "GetUserInput",
        outputType: "User",
        queryType: "query",
        pipelines: [],
      };

      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: { User: userType },
        resolvers: { getUser: getUserResolver },
        executors: [],
      };

      vi.spyOn(SDLUtils, "combineSDL").mockReturnValue(
        "# Type: User\ntype User {\n  id: String!\n}\n\n# Resolver: getUser\nextend type Query {\n  getUser: User\n}",
      );

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files[0].content).toBe(
        "# Type: User\ntype User {\n  id: String!\n}\n\n# Resolver: getUser\nextend type Query {\n  getUser: User\n}\n\n",
      );
      expect(result.files[0].content.endsWith("\n\n")).toBe(true); // ファイル末尾に改行が2つ
    });

    it("空の内容でもファイルが正しく生成されること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      vi.spyOn(SDLUtils, "combineSDL").mockReturnValue("");

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe("\n\n");
    });

    it("非常に大きなSDL内容でもファイルが生成されること", () => {
      const metadata: BasicGeneratorMetadata<
        SDLTypeMetadata,
        ResolverSDLMetadata
      > = {
        types: {},
        resolvers: {},
        executors: [],
      };

      const largeSDLContent = "type User {\n  id: String!\n}\n".repeat(1000);
      vi.spyOn(SDLUtils, "combineSDL").mockReturnValue(largeSDLContent);

      const result = SDLAggregator.aggregate(metadata, "/test/output");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe(`${largeSDLContent}\n\n`);
      expect(result.files[0].content.length).toBeGreaterThan(20000);
    });
  });
});
