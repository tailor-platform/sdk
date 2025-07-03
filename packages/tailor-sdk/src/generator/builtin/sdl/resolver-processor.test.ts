import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResolverProcessor } from "./resolver-processor";
import { Resolver } from "@/services/pipeline/resolver";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { TypeProcessor } from "./type-processor";

// TypeProcessorのモック
vi.mock("./type-processor", () => ({
  TypeProcessor: {
    processType: vi.fn(),
  },
}));

describe("SDL ResolverProcessor", () => {
  let mockResolver: Resolver;

  beforeEach(() => {
    vi.clearAllMocks();

    // TypeProcessor.processTypeのデフォルトモック
    (TypeProcessor.processType as any).mockImplementation(
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
      expect(result.pipelines).toHaveLength(3);
    });

    it("mutationリゾルバーを正しく処理すること", async () => {
      const mutationResolver = {
        ...mockResolver,
        name: "updateUser",
        queryType: "mutation",
      } as any;

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
      (TypeProcessor.processType as any)
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
      await ResolverProcessor.processResolver(mockResolver);

      expect(TypeProcessor.processType).toHaveBeenCalledTimes(2);

      // input型の処理
      expect(TypeProcessor.processType).toHaveBeenNthCalledWith(
        1,
        mockResolver.input,
        true,
        "GetUserByIdInput",
      );

      // output型の処理
      expect(TypeProcessor.processType).toHaveBeenNthCalledWith(
        2,
        mockResolver.output,
        false,
        "GetUserByIdOutput",
      );
    });

    it("複数のfnステップを正しく処理すること", async () => {
      const resolverWithMultipleFnSteps = {
        ...mockResolver,
        steps: [
          ["fn", "step1", () => {}, {}],
          ["fn", "step2", () => {}, {}],
          ["fn", "step3", () => {}, {}],
        ],
      } as any;

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
      const resolverWithMultipleSqlSteps = {
        ...mockResolver,
        steps: [
          ["sql", "getUserQuery", () => {}, {}],
          ["sql", "getPostsQuery", () => {}, {}],
        ],
      } as any;

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
      const resolverWithMultipleGqlSteps = {
        ...mockResolver,
        steps: [
          ["gql", "fetchUserProfile", () => {}, {}],
          ["gql", "fetchUserPosts", () => {}, {}],
        ],
      } as any;

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
      const resolverWithMixedSteps = {
        ...mockResolver,
        steps: [
          ["fn", "validateInput", () => {}, {}],
          ["sql", "queryDatabase", () => {}, {}],
          ["gql", "fetchFromGraphQL", () => {}, {}],
          ["fn", "processResult", () => {}, {}],
        ],
      } as any;

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

    it("未対応のステップタイプでエラーを投げること", async () => {
      const resolverWithUnsupportedStep = {
        ...mockResolver,
        steps: [["unsupported", "invalidStep", () => {}, {}]],
      } as any;

      await expect(
        ResolverProcessor.processResolver(resolverWithUnsupportedStep),
      ).rejects.toThrow("Unsupported step kind: unsupported");
    });

    it("ステップが空の場合を正しく処理すること", async () => {
      const resolverWithEmptySteps = {
        ...mockResolver,
        steps: [],
      } as any;

      const result = await ResolverProcessor.processResolver(
        resolverWithEmptySteps,
      );

      expect(result.pipelines).toHaveLength(0);
      expect(result.sdl).toContain("extend type Query");
      expect(result.sdl).toContain(
        "getUserById(input: GetUserByIdInput): GetUserByIdOutput",
      );
    });

    it("複雑なリゾルバー名を正しく処理すること", async () => {
      const complexNameResolver = {
        ...mockResolver,
        name: "getUserByIdAndStatus",
      } as any;

      const result =
        await ResolverProcessor.processResolver(complexNameResolver);

      expect(result.name).toBe("getUserByIdAndStatus");
      expect(result.inputType).toBe("GetUserByIdAndStatusInput");
      expect(result.outputType).toBe("GetUserByIdAndStatusOutput");
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
      const mutationResolver = {
        ...mockResolver,
        name: "createUser",
        queryType: "mutation",
      } as any;

      const sdl =
        await ResolverProcessor.processResolverToSDL(mutationResolver);

      expect(sdl).toContain("extend type Mutation");
      expect(sdl).toContain(
        "createUser(input: CreateUserInput): CreateUserOutput",
      );
    });

    it("空のステップを持つリゾルバーのSDLを正しく生成すること", async () => {
      const emptyStepsResolver = {
        ...mockResolver,
        steps: [],
      } as any;

      const sdl =
        await ResolverProcessor.processResolverToSDL(emptyStepsResolver);

      expect(sdl).toContain("input GetUserByIdInput");
      expect(sdl).toContain("type GetUserByIdOutput");
      expect(sdl).toContain("extend type Query");
    });
  });

  describe("processResolvers", () => {
    it("複数のリゾルバーを正しく処理すること", async () => {
      const resolver1 = {
        ...mockResolver,
        name: "getUserById",
        queryType: "query",
      } as any;

      const resolver2 = {
        ...mockResolver,
        name: "createUser",
        queryType: "mutation",
      } as any;

      const resolver3 = {
        ...mockResolver,
        name: "updateUser",
        queryType: "mutation",
      } as any;

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
      const resolver1 = {
        ...mockResolver,
        name: "getUser",
        queryType: "query",
      } as any;

      const resolver2 = {
        ...mockResolver,
        name: "getUser",
        queryType: "mutation",
      } as any;

      const resolvers = [resolver1, resolver2];
      const sdl = await ResolverProcessor.processResolvers(resolvers);

      expect(sdl).toContain("# Resolver: getUser");
      const resolverCommentCount = (sdl.match(/# Resolver: getUser/g) || [])
        .length;
      expect(resolverCommentCount).toBe(2);
    });

    it("リゾルバー処理でエラーが発生した場合の処理", async () => {
      const validResolver = mockResolver;
      const invalidResolver = {
        ...mockResolver,
        output: undefined, // outputが未定義でエラーになる
      } as any;

      const resolvers = [validResolver, invalidResolver];

      await expect(
        ResolverProcessor.processResolvers(resolvers),
      ).rejects.toThrow("must have an output type defined");
    });
  });

  describe("Input/Output型処理のテスト", () => {
    it("複雑なInput型を正しく処理すること", async () => {
      const complexInputResolver = {
        ...mockResolver,
        input: {
          name: "ComplexInput",
          fields: {
            user: {
              _metadata: { type: "nested", required: true, array: false },
              fields: {
                profile: {
                  _metadata: { type: "nested", required: true, array: false },
                  fields: {
                    name: {
                      _metadata: {
                        type: "string",
                        required: true,
                        array: false,
                      },
                    },
                    age: {
                      _metadata: {
                        type: "integer",
                        required: false,
                        array: false,
                      },
                    },
                  },
                },
              },
            },
            tags: {
              _metadata: { type: "string", required: true, array: true },
            },
            metadata: {
              _metadata: { type: "json", required: false, array: false },
            },
          },
        },
      } as any;

      (TypeProcessor.processType as any).mockResolvedValueOnce({
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
      const complexOutputResolver = {
        ...mockResolver,
        output: {
          name: "ComplexOutput",
          fields: {
            result: {
              _metadata: { type: "nested", required: true, array: false },
              fields: {
                user: {
                  _metadata: { type: "nested", required: true, array: false },
                  fields: {
                    id: {
                      _metadata: {
                        type: "string",
                        required: true,
                        array: false,
                      },
                    },
                    profile: {
                      _metadata: {
                        type: "nested",
                        required: false,
                        array: false,
                      },
                      fields: {
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
                posts: {
                  _metadata: { type: "nested", required: false, array: true },
                },
              },
            },
            success: {
              _metadata: { type: "boolean", required: true, array: false },
            },
          },
        },
      } as any;

      (TypeProcessor.processType as any)
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
      const arrayTypeResolver = {
        ...mockResolver,
        input: {
          fields: {
            ids: { _metadata: { type: "string", required: true, array: true } },
            filters: {
              _metadata: { type: "string", required: false, array: true },
            },
          },
        },
        output: {
          fields: {
            users: {
              _metadata: { type: "nested", required: true, array: true },
            },
            errors: {
              _metadata: { type: "string", required: false, array: true },
            },
          },
        },
      } as any;

      (TypeProcessor.processType as any)
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
    it("subscriptionタイプのリゾルバーを処理できること", async () => {
      const subscriptionResolver = {
        ...mockResolver,
        name: "userUpdated",
        queryType: "subscription",
      } as any;

      const result =
        await ResolverProcessor.processResolver(subscriptionResolver);

      expect(result.queryType).toBe("subscription");
      expect(result.sdl).toContain("extend type Subscription");
      expect(result.sdl).toContain(
        "userUpdated(input: UserUpdatedInput): UserUpdatedOutput",
      );
    });

    it("カスタム型名を持つリゾルバーを正しく処理すること", async () => {
      const customTypeResolver = {
        ...mockResolver,
        name: "complexOperationWithVeryLongName",
      } as any;

      const result =
        await ResolverProcessor.processResolver(customTypeResolver);

      expect(result.inputType).toBe("ComplexOperationWithVeryLongNameInput");
      expect(result.outputType).toBe("ComplexOperationWithVeryLongNameOutput");
    });

    it("特殊文字を含む名前のリゾルバーを処理できること", async () => {
      const specialNameResolver = {
        ...mockResolver,
        name: "get_user_by_id", // アンダースコアを含む
      } as any;

      const result =
        await ResolverProcessor.processResolver(specialNameResolver);

      expect(result.name).toBe("get_user_by_id");
      expect(result.inputType).toBe("Get_user_by_idInput");
      expect(result.outputType).toBe("Get_user_by_idOutput");
    });

    it("極小のリゾルバー定義を正しく処理すること", async () => {
      const minimalResolver = {
        name: "ping",
        queryType: "query",
        input: { fields: {} },
        output: {
          fields: {
            pong: {
              _metadata: { type: "string", required: true, array: false },
            },
          },
        },
        steps: [],
      } as any;

      (TypeProcessor.processType as any)
        .mockResolvedValueOnce({
          name: "PingInput",
          fields: [],
          isInput: true,
        })
        .mockResolvedValueOnce({
          name: "PingOutput",
          fields: [
            { name: "pong", type: "String", required: true, array: false },
          ],
          isInput: false,
        });

      const result = await ResolverProcessor.processResolver(minimalResolver);

      expect(result.name).toBe("ping");
      expect(result.pipelines).toHaveLength(0);
      expect(result.sdl).toContain("ping(input: PingInput): PingOutput");
    });

    it("非常に複雑なパイプライン構成を処理できること", async () => {
      const complexPipelineResolver = {
        ...mockResolver,
        steps: Array.from({ length: 10 }, (_, i) => [
          i % 3 === 0 ? "fn" : i % 3 === 1 ? "sql" : "gql",
          `step${i + 1}`,
          () => {},
          {},
        ]),
      } as any;

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
      (TypeProcessor.processType as any).mockRejectedValueOnce(
        new Error("Type processing failed"),
      );

      await expect(
        ResolverProcessor.processResolver(mockResolver),
      ).rejects.toThrow("Type processing failed");
    });

    it("不正なステップ定義でエラーが発生した場合の処理", async () => {
      const invalidStepResolver = {
        ...mockResolver,
        steps: [
          ["fn", "validStep", () => {}, {}],
          ["invalid", "invalidStep", () => {}, {}],
          ["sql", "anotherValidStep", () => {}, {}],
        ],
      } as any;

      await expect(
        ResolverProcessor.processResolver(invalidStepResolver),
      ).rejects.toThrow("Unsupported step kind: invalid");
    });

    it("部分的に不正なステップ配列を処理できること", async () => {
      const partiallyValidResolver = {
        ...mockResolver,
        steps: [
          ["fn", "step1", () => {}, {}],
          [null, "invalidStep", () => {}, {}], // nullタイプ
        ],
      } as any;

      await expect(
        ResolverProcessor.processResolver(partiallyValidResolver),
      ).rejects.toThrow("Unsupported step kind: null");
    });

    it("TypeProcessorから不正なメタデータが返された場合の処理", async () => {
      (TypeProcessor.processType as any)
        .mockResolvedValueOnce(null) // 不正な戻り値
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
