import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResolverProcessor } from "./resolver-processor";
import {
  Resolver,
  createMutationResolver,
  createQueryResolver,
} from "@/services/pipeline/resolver";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { TypeProcessor } from "./type-processor";
import { t } from "@/types";

describe("SDL ResolverProcessor", () => {
  let mockResolver: Resolver;

  beforeEach(() => {
    vi.clearAllMocks();

    // TypeProcessor.processTypeのスパイ設定
    vi.spyOn(TypeProcessor, "processType").mockImplementation(
      async (type: any, isInput = false, name?: string) => {
        const actualName = name || type?.name || "UnknownType";
        return {
          name: actualName,
          fields: [
            {
              name: "id",
              type: "String",
              required: true,
              array: false,
            },
            {
              name: "name",
              type: "String",
              required: false,
              array: false,
            },
          ],
          isInput,
        };
      },
    );

    // 基本的なモックResolverの作成
    mockResolver = {
      name: "getUserById",
      queryType: "query",
      input: {
        name: "GetUserByIdInput",
        fields: {
          id: {
            _metadata: {
              type: "string",
              required: true,
              array: false,
            },
          },
        },
      },
      output: {
        name: "GetUserByIdOutput",
        fields: {
          user: {
            _metadata: {
              type: "nested",
              required: true,
              array: false,
            },
            fields: {
              id: {
                _metadata: {
                  type: "string",
                  required: true,
                  array: false,
                },
              },
              name: {
                _metadata: {
                  type: "string",
                  required: true,
                  array: false,
                },
              },
            },
          },
        },
      },
      steps: [
        ["fn", "fetchUser", () => {}, {}],
        ["sql", "getUserData", () => {}, {}],
        ["gql", "fetchUserProfile", () => {}, {}],
      ],
    } as any;
    mockResolver = createQueryResolver(
      "getUserById",
      t.type({
        id: t.string(),
      }),
    )
      .fnStep("fetchUser", () => {})
      .returns(
        (context) => ({ user: { id: context.input.id, name: "name" } }),
        t.type({ user: t.object({ id: t.string(), name: t.string() }) }),
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processResolver", () => {
    it("基本的なqueryリゾルバーを正しく処理すること", async () => {
      const result = await ResolverProcessor.processResolver(mockResolver);

      expect(result.name).toBe("getUserById");
      expect(result.queryType).toBe("query");
      expect(result.inputType).toBe("GetUserByIdInput");
      expect(result.outputType).toBe("GetUserByIdOutput");
      expect(result.pipelines).toHaveLength(1);
    });

    it("mutationリゾルバーを正しく処理すること", async () => {
      const mutationResolver = createMutationResolver(
        "updateUser",
        t.type({}),
      ).returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(mutationResolver);

      expect(result.name).toBe("updateUser");
      expect(result.queryType).toBe("mutation");
      expect(result.inputType).toBe("UpdateUserInput");
      expect(result.outputType).toBe("UpdateUserOutput");
    });

    it("outputが未定義の場合にエラーを投げること", async () => {
      const resolverWithoutOutput = {
        ...mockResolver,
        output: undefined,
      } as any;

      await expect(
        ResolverProcessor.processResolver(resolverWithoutOutput),
      ).rejects.toThrow(
        'Resolver "getUserById" must have an output type defined. Use .returns() to specify the output type.',
      );
    });

    it("正しいSDLを生成すること", async () => {
      const processTypeSpy = vi.spyOn(TypeProcessor, "processType");

      processTypeSpy
        .mockResolvedValueOnce({
          name: "GetUserByIdInput",
          fields: [
            { name: "id", type: "String", required: true, array: false },
          ],
          isInput: true,
        })
        .mockResolvedValueOnce({
          name: "GetUserByIdOutput",
          fields: [
            { name: "id", type: "String", required: true, array: false },
            { name: "name", type: "String", required: true, array: false },
          ],
          isInput: false,
        });

      const result = await ResolverProcessor.processResolver(mockResolver);

      expect(result.sdl).toContain("input GetUserByIdInput");
      expect(result.sdl).toContain("type GetUserByIdOutput");
      expect(result.sdl).toContain("extend type Query");
      expect(result.sdl).toContain(
        "getUserById(input: GetUserByIdInput): GetUserByIdOutput",
      );
    });

    it("TypeProcessorに正しいパラメーターを渡すこと", async () => {
      const processTypeSpy = vi.spyOn(TypeProcessor, "processType");

      await ResolverProcessor.processResolver(mockResolver);

      expect(processTypeSpy).toHaveBeenCalledTimes(2);

      // input型の処理
      expect(processTypeSpy).toHaveBeenNthCalledWith(
        1,
        mockResolver.input,
        true,
        "GetUserByIdInput",
      );

      // output型の処理
      expect(processTypeSpy).toHaveBeenNthCalledWith(
        2,
        mockResolver.output,
        false,
        "GetUserByIdOutput",
      );
    });

    it("複数のfnステップを正しく処理すること", async () => {
      const resolverWithMultipleFnSteps = createQueryResolver(
        "getUserById",
        t.type({ id: t.string() }),
      )
        .fnStep("step1", () => {})
        .fnStep("step2", () => {})
        .fnStep("step3", () => {})
        .returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(
        resolverWithMultipleFnSteps,
      );

      expect(result.pipelines).toHaveLength(3);
      result.pipelines.forEach((pipeline: any, index) => {
        expect(pipeline.name).toBe(`step${index + 1}`);
        expect(pipeline.description).toBe(`step${index + 1}`);
        expect(pipeline.operationType).toBe(
          PipelineResolver_OperationType.FUNCTION,
        );
        expect(pipeline.operationSource).toBe("");
        expect(pipeline.operationName).toBe(`step${index + 1}`);
      });
    });

    it("複数のsqlステップを正しく処理すること", async () => {
      const resolverWithMultipleSqlSteps = createQueryResolver(
        "getUserById",
        t.type({ id: t.string() }),
      )
        .sqlStep("getUserQuery", async () => {})
        .sqlStep("getPostsQuery", async () => {})
        .returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(
        resolverWithMultipleSqlSteps,
      );

      expect(result.pipelines).toHaveLength(2);
      expect((result.pipelines[0] as any).name).toBe("getUserQuery");
      expect((result.pipelines[0] as any).operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect((result.pipelines[1] as any).name).toBe("getPostsQuery");
      expect((result.pipelines[1] as any).operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
    });

    it("複数のgqlステップを正しく処理すること", async () => {
      const resolverWithMultipleGqlSteps = createQueryResolver(
        "getUserById",
        t.type({ id: t.string() }),
      )
        .gqlStep("fetchUserProfile", ({ client }) => client.query("", {}))
        .gqlStep("fetchUserPosts", ({ client }) => client.query("", {}))
        .returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(
        resolverWithMultipleGqlSteps,
      );

      expect(result.pipelines).toHaveLength(2);
      expect((result.pipelines[0] as any).name).toBe("fetchUserProfile");
      expect((result.pipelines[0] as any).operationType).toBe(
        PipelineResolver_OperationType.GRAPHQL,
      );
      expect((result.pipelines[1] as any).name).toBe("fetchUserPosts");
      expect((result.pipelines[1] as any).operationType).toBe(
        PipelineResolver_OperationType.GRAPHQL,
      );
    });

    it("混合ステップタイプを正しく処理すること", async () => {
      const resolverWithMixedSteps = createQueryResolver(
        "getUserById",
        t.type({ id: t.string() }),
      )
        .fnStep("validateInput", () => ({}))
        .sqlStep("queryDatabase", async () => ({}))
        .gqlStep("fetchFromGraphQL", ({ client }) => client.query("", {}))
        .fnStep("processResult", () => ({}))
        .returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(
        resolverWithMixedSteps,
      );

      expect(result.pipelines).toHaveLength(4);
      expect((result.pipelines[0] as any).operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect((result.pipelines[1] as any).operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect((result.pipelines[2] as any).operationType).toBe(
        PipelineResolver_OperationType.GRAPHQL,
      );
      expect((result.pipelines[3] as any).operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
    });
  });

  describe("processResolverToSDL", () => {
    it("SDLメタデータからSDL文字列を正しく抽出すること", async () => {
      const sdl = await ResolverProcessor.processResolverToSDL(mockResolver);

      expect(typeof sdl).toBe("string");
      expect(sdl).toContain("input GetUserByIdInput");
      expect(sdl).toContain("type GetUserByIdOutput");
      expect(sdl).toContain("extend type Query");
      expect(sdl).toContain(
        "getUserById(input: GetUserByIdInput): GetUserByIdOutput",
      );
    });

    it("mutation リゾルバーのSDLを正しく生成すること", async () => {
      const mutationResolver = createMutationResolver(
        "createUser",
        t.type({}),
      ).returns(() => ({}), t.type({}));

      const sdl =
        await ResolverProcessor.processResolverToSDL(mutationResolver);

      expect(sdl).toContain("extend type Mutation");
      expect(sdl).toContain(
        "createUser(input: CreateUserInput): CreateUserOutput",
      );
    });
  });

  describe("processResolvers", () => {
    it("複数のリゾルバーを正しく処理すること", async () => {
      const resolver1 = createQueryResolver("getUserById", t.type({})).returns(
        () => ({}),
        t.type({}),
      );

      const resolver2 = createMutationResolver(
        "createUser",
        t.type({}),
      ).returns(() => ({}), t.type({}));

      const resolver3 = createMutationResolver(
        "updateUser",
        t.type({}),
      ).returns(() => ({}), t.type({}));

      const resolvers = [resolver1, resolver2, resolver3];
      const combinedSDL = await ResolverProcessor.processResolvers(resolvers);

      expect(combinedSDL).toContain("# Resolver: getUserById");
      expect(combinedSDL).toContain("# Resolver: createUser");
      expect(combinedSDL).toContain("# Resolver: updateUser");
      expect(combinedSDL).toContain("extend type Query");
      expect(combinedSDL).toContain("extend type Mutation");
    });

    it("空のリゾルバー配列を正しく処理すること", async () => {
      const sdl = await ResolverProcessor.processResolvers([]);
      expect(sdl).toBe("");
    });

    it("単一のリゾルバーを正しく処理すること", async () => {
      const singleResolver = [mockResolver];
      const sdl = await ResolverProcessor.processResolvers(singleResolver);

      expect(sdl).toContain("# Resolver: getUserById");
      expect(sdl).toContain("input GetUserByIdInput");
      expect(sdl).toContain("type GetUserByIdOutput");
      expect(sdl).toContain("extend type Query");
    });

    it("同じ名前の複数のリゾルバーを処理できること", async () => {
      const resolver1 = createQueryResolver("getUser", t.type({})).returns(
        () => ({}),
        t.type({}),
      );

      const resolvers = [resolver1, resolver1];
      const sdl = await ResolverProcessor.processResolvers(resolvers);

      expect(sdl).toContain("# Resolver: getUser");
      const resolverCommentCount = (sdl.match(/# Resolver: getUser/g) || [])
        .length;
      expect(resolverCommentCount).toBe(2);
    });

    it("リゾルバー処理でエラーが発生した場合の処理", async () => {
      const validResolver = mockResolver;
      const invalidResolver = createQueryResolver(
        "invalidResolver",
        t.type({}),
      );

      const resolvers = [validResolver, invalidResolver];

      await expect(
        ResolverProcessor.processResolvers(resolvers),
      ).rejects.toThrow("must have an output type defined");
    });
  });

  describe("Input/Output型処理のテスト", () => {
    it("複雑なInput型を正しく処理すること", async () => {
      const complexInputResolver = createQueryResolver(
        "getUserById",
        t.type({
          user: t.object({
            profile: t.object({
              name: t.string(),
              age: t.int().optional(),
            }),
          }),
          tags: t.string().array(),
          metadata: t.object({}),
        }),
      ).returns(() => ({}), t.type({}));

      vi.spyOn(TypeProcessor, "processType").mockResolvedValueOnce({
        name: "ComplexInput",
        fields: [
          { name: "user", type: "UserInput", required: true, array: false },
          { name: "tags", type: "[String!]", required: true, array: true },
          { name: "metadata", type: "JSON", required: false, array: false },
        ],
        isInput: true,
      });

      const result =
        await ResolverProcessor.processResolver(complexInputResolver);

      expect(TypeProcessor.processType).toHaveBeenCalledWith(
        complexInputResolver.input,
        true,
        "GetUserByIdInput",
      );
      expect(result.inputType).toBe("ComplexInput");
    });

    it("複雑なOutput型を正しく処理すること", async () => {
      const complexOutputResolver = createQueryResolver(
        "getUserById",
        t.type({}),
      ).returns(
        () => ({}) as any,
        t.type({
          result: t.object({
            user: t.object({
              id: t.string(),
              profile: t.object({
                name: t.string(),
              }),
            }),
            posts: t.object({}).array().optional(),
          }),
        }),
      );

      vi.spyOn(TypeProcessor, "processType")
        .mockResolvedValueOnce({
          name: "GetUserByIdInput",
          fields: [],
          isInput: true,
        })
        .mockResolvedValueOnce({
          name: "ComplexOutput",
          fields: [
            {
              name: "result",
              type: "ResultType",
              required: true,
              array: false,
            },
            { name: "success", type: "Boolean", required: true, array: false },
          ],
          isInput: false,
        });

      const result = await ResolverProcessor.processResolver(
        complexOutputResolver,
      );
      expect(TypeProcessor.processType).toHaveBeenCalledWith(
        complexOutputResolver.output,
        false,
        "GetUserByIdOutput",
      );
      expect(result.outputType).toBe("ComplexOutput");
    });

    it("配列型のInput/Outputを正しく処理すること", async () => {
      const arrayTypeResolver = createQueryResolver(
        "getUserById",
        t.type({
          ids: t.string().array(),
          filters: t.string().array().optional(),
        }),
      ).returns(
        () => ({}) as any,
        t.type({
          users: t.object({ id: t.string(), name: t.string() }).array(),
          errors: t.string().array().optional(),
        }),
      );

      vi.spyOn(TypeProcessor, "processType")
        .mockResolvedValueOnce({
          name: "GetUserByIdInput",
          fields: [
            { name: "ids", type: "[String!]", required: true, array: true },
            { name: "filters", type: "[String]", required: false, array: true },
          ],
          isInput: true,
        })
        .mockResolvedValueOnce({
          name: "GetUserByIdOutput",
          fields: [
            { name: "users", type: "[User!]", required: true, array: true },
            { name: "errors", type: "[String]", required: false, array: true },
          ],
          isInput: false,
        });

      const result = await ResolverProcessor.processResolver(arrayTypeResolver);

      expect(result.inputType).toBe("GetUserByIdInput");
      expect(result.outputType).toBe("GetUserByIdOutput");
    });
  });

  describe("異なるGraphQLリゾルバー形式での動作テスト", () => {
    it("特殊文字を含む名前のリゾルバーを処理できること", async () => {
      const specialNameResolver = createQueryResolver(
        "get_user_by_id",
        t.type({ id: t.string() }),
      ).returns(() => ({}), t.type({}));

      const result =
        await ResolverProcessor.processResolver(specialNameResolver);

      expect(result.name).toBe("get_user_by_id");
      expect(result.inputType).toBe("Get_user_by_idInput");
      expect(result.outputType).toBe("Get_user_by_idOutput");
    });

    it("非常に複雑なパイプライン構成を処理できること", async () => {
      let complexPipelineResolver: Resolver = createQueryResolver(
        "complexPipeline",
        t.type({}),
      );
      Array.from({ length: 10 }).forEach((_, i) => {
        switch (i % 3) {
          case 0:
            complexPipelineResolver = complexPipelineResolver.fnStep(
              `step${i + 1}`,
              () => {},
            );
            break;
          case 1:
            complexPipelineResolver = complexPipelineResolver.sqlStep(
              `step${i + 1}`,
              async () => {},
            );
            break;
          case 2:
            complexPipelineResolver = complexPipelineResolver.gqlStep(
              `step${i + 1}`,
              ({ client }: any) => client.query("", {}),
            );
            break;
        }
      });
      complexPipelineResolver.returns(() => ({}), t.type({}));

      const result = await ResolverProcessor.processResolver(
        complexPipelineResolver,
      );

      expect(result.pipelines).toHaveLength(10);

      // パイプラインタイプの確認
      result.pipelines.forEach((pipeline, index) => {
        const expectedType =
          index % 3 === 0
            ? PipelineResolver_OperationType.FUNCTION
            : index % 3 === 1
              ? PipelineResolver_OperationType.FUNCTION
              : PipelineResolver_OperationType.GRAPHQL;
        expect((pipeline as any).operationType).toBe(expectedType);
        expect((pipeline as any).name).toBe(`step${index + 1}`);
      });
    });
  });

  describe("エラーハンドリングとリカバリのテスト", () => {
    it("TypeProcessor.processTypeでエラーが発生した場合の処理", async () => {
      vi.spyOn(TypeProcessor, "processType").mockRejectedValueOnce(
        new Error("Type processing failed"),
      );

      await expect(
        ResolverProcessor.processResolver(mockResolver),
      ).rejects.toThrow("Type processing failed");
    });

    it("不正なステップ定義でエラーが発生した場合の処理", async () => {
      const invalidStepResolver = createQueryResolver(
        "invalidStepResolver",
        t.type({}),
      )
        .fnStep("validStep", () => {})
        .sqlStep("anotherValidStep", async () => {})
        .returns(() => ({}), t.type({}));
      (invalidStepResolver as any).steps = [
        ["fn", "validStep", () => {}, {}],
        ["invalid", "invalidStep", () => {}, {}],
        ["sql", "anotherValidStep", () => {}, {}],
      ];

      await expect(
        ResolverProcessor.processResolver(invalidStepResolver),
      ).rejects.toThrow("Unsupported step kind: invalid");
    });

    it("TypeProcessorから不正なメタデータが返された場合の処理", async () => {
      vi.spyOn(TypeProcessor, "processType")
        .mockResolvedValueOnce(null as any) // 不正な戻り値
        .mockResolvedValueOnce({
          name: "ValidOutput",
          fields: [],
          isInput: false,
        });

      // エラーが発生するか、適切にハンドリングされることを確認
      await expect(
        ResolverProcessor.processResolver(mockResolver),
      ).rejects.toThrow();
    });
  });
});
