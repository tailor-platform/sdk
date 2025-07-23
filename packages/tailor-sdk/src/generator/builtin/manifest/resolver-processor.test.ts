import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResolverProcessor } from "./resolver-processor";
import {
  createQueryResolver,
  createMutationResolver,
} from "@/services/pipeline";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/types";
import type { PathOrFileDescriptor } from "fs-extra";
import { getDistDir } from "@/config";

describe("ResolverProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(fs, "readFileSync").mockImplementation(
      (filePath: PathOrFileDescriptor) => {
        if (typeof filePath !== "string") {
          throw new Error("Invalid file path");
        }
        if (filePath.includes("fetchData.js")) {
          return "function fetchData() { return { id: '1', data: 'test' }; }";
        }
        if (filePath.includes("processData.js")) {
          return "function processData(input) { return { processed: true, input }; }";
        }
        if (filePath.includes("queryUsers.js")) {
          return "SELECT * FROM users WHERE id = $1";
        }
        if (filePath.includes("step1.js")) return "step1 function";
        if (filePath.includes("step2.js")) return "step2 sql";
        if (filePath.includes("step3.js")) return "step3 function";
        if (filePath.includes("step5.js")) return "step5 sql";
        throw new Error(`File not found: ${filePath}`);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processResolver", () => {
    it("基本的なResolverを正しく処理すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({
          id: t.string(),
          name: t.string().optional(),
          tags: t.string().array(),
        }),
      )
        .fnStep("fetchData", () => ({ id: "1", data: "test" }))
        .sqlStep("queryUsers", async () => "SELECT * FROM users WHERE id = $1")
        .returns(
          (context) => ({
            result: context.fetchData.id,
            count: 1,
          }),
          t.type({
            result: t.string(),
            count: t.int(),
          }),
        );

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(result.name).toBe("testResolver");
      expect(result.inputType).toBe("TestResolverInput");
      expect(result.outputType).toBe("TestResolverOutput");
      expect(result.queryType).toBe("query");
      expect(result.pipelines).toHaveLength(2);
      expect(result.outputMapper).toBeDefined();
    });

    it("input型フィールドを正しく抽出すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({
          id: t.string(),
          name: t.string().optional(),
          tags: t.string().array(),
        }),
      ).returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(result.inputFields).toBeDefined();
      expect(result.inputFields!.id).toEqual({
        type: "string",
        required: true,
        array: false,
      });
      expect(result.inputFields!.name).toEqual({
        type: "string",
        required: false,
        array: false,
      });
      expect(result.inputFields!.tags).toEqual({
        type: "string",
        required: true,
        array: true,
      });
    });

    it("output型フィールドを正しく抽出すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      ).returns(
        () => ({ result: "test", count: 1 }),
        t.type({
          result: t.string(),
          count: t.int(),
        }),
      );

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(result.outputFields).toBeDefined();
      expect(result.outputFields!.result).toEqual({
        type: "string",
        required: true,
        array: false,
      });
      expect(result.outputFields!.count).toEqual({
        type: "integer",
        required: true,
        array: false,
      });
    });

    it("fnステップを正しく処理すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("fetchData", () => ({ id: "1", data: "test" }))
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      const fnStep = result.pipelines.find((p) => p.name === "fetchData");
      expect(fnStep).toBeDefined();
      expect(fnStep!.description).toBe("fetchData");
      expect(fnStep!.operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect(fnStep!.operationSource).toBe(
        "function fetchData() { return { id: '1', data: 'test' }; }",
      );
    });

    it("sqlステップを正しく処理すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      )
        .sqlStep("queryUsers", async () => "SELECT * FROM users WHERE id = $1")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      const sqlStep = result.pipelines.find((p) => p.name === "queryUsers");
      expect(sqlStep).toBeDefined();
      expect(sqlStep!.description).toBe("queryUsers");
      expect(sqlStep!.operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect(sqlStep!.operationSource).toBe(
        "SELECT * FROM users WHERE id = $1",
      );
    });

    it("mutationタイプのResolverを正しく処理すること", async () => {
      const mutationResolver = createMutationResolver(
        "updateUser",
        t.type({
          id: t.string(),
          name: t.string(),
        }),
      ).returns(() => ({ success: true }), t.type({ success: t.bool() }));

      const result = await ResolverProcessor.processResolver(mutationResolver);

      expect(result.name).toBe("updateUser");
      expect(result.inputType).toBe("UpdateUserInput");
      expect(result.outputType).toBe("UpdateUserOutput");
      expect(result.queryType).toBe("mutation");
    });

    it("outputMapperが未定義の場合を正しく処理すること", async () => {
      // outputMapperが設定されていないリゾルバーを作成
      const resolverWithoutMapper = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      );

      const result = await ResolverProcessor.processResolver(
        resolverWithoutMapper,
      );

      expect(result.outputMapper).toBeUndefined();
    });

    it("ファイルが見つからない場合の警告処理", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // ファイルが見つからない場合のエラーをシミュレート
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const testResolver = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("fetchData", () => ({ id: "1", data: "test" }))
        .sqlStep("queryUsers", async () => "SELECT * FROM users WHERE id = $1")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2); // fnとsqlステップでファイルが見つからない

      const fetchDataStep = result.pipelines.find(
        (p) => p.name === "fetchData",
      );
      expect(fetchDataStep!.operationSource).toBe("");

      consoleWarnSpy.mockRestore();
    });

    it("複雑なステップ構成を正しく処理すること", async () => {
      const complexResolver = createQueryResolver(
        "complexResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("step1", () => "step1 result")
        .sqlStep("step2", async () => "step2 sql")
        .fnStep("step3", () => "step3 result")
        .returns(() => ({ result: "complex" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(complexResolver);

      expect(result.pipelines).toHaveLength(3);
      expect(result.pipelines[0].name).toBe("step1");
      expect(result.pipelines[0].operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect(result.pipelines[1].name).toBe("step2");
      expect(result.pipelines[1].operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
      expect(result.pipelines[2].name).toBe("step3");
    });
  });

  describe("processResolvers", () => {
    it("複数のResolverを正しく処理すること", async () => {
      const resolver1 = createQueryResolver(
        "resolver1",
        t.type({ id: t.string() }),
      ).returns(() => ({ result: "1" }), t.type({ result: t.string() }));

      const resolver2 = createMutationResolver(
        "resolver2",
        t.type({ data: t.string() }),
      ).returns(() => ({ success: true }), t.type({ success: t.bool() }));

      const resolvers = [resolver1, resolver2];
      const result = await ResolverProcessor.processResolvers(resolvers);

      expect(Object.keys(result)).toHaveLength(2);
      expect(result.resolver1).toBeDefined();
      expect(result.resolver2).toBeDefined();

      expect(result.resolver1.name).toBe("resolver1");
      expect(result.resolver1.queryType).toBe("query");
      expect(result.resolver2.name).toBe("resolver2");
      expect(result.resolver2.queryType).toBe("mutation");
    });

    it("空のResolvers配列を正しく処理すること", async () => {
      const result = await ResolverProcessor.processResolvers([]);
      expect(result).toEqual({});
    });
  });

  describe("extractTypeFields", () => {
    it("正常なフィールド情報を正しく抽出すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({
          stringField: t.string(),
          intField: t.int().optional(),
          arrayField: t.string().array(),
        }),
      ).returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(result.inputFields).toBeDefined();
      expect(result.inputFields!.stringField).toEqual({
        type: "string",
        required: true,
        array: false,
      });
      expect(result.inputFields!.intField).toEqual({
        type: "integer",
        required: false,
        array: false,
      });
      expect(result.inputFields!.arrayField).toEqual({
        type: "string",
        required: true,
        array: true,
      });
    });

    it("様々な型の組み合わせを正しく処理すること", async () => {
      const testResolver = createQueryResolver(
        "testResolver",
        t.type({
          id: t.uuid(),
          scores: t.float().array().optional(),
          active: t.bool(),
        }),
      ).returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(testResolver);

      expect(result.inputFields).toBeDefined();
      expect(result.inputFields!.id.type).toBe("uuid");
      expect(result.inputFields!.scores.type).toBe("float");
      expect(result.inputFields!.scores.array).toBe(true);
      expect(result.inputFields!.scores.required).toBe(false);
      expect(result.inputFields!.active.type).toBe("bool");
    });
  });

  describe("ファイルシステム操作のテスト", () => {
    it("正しいファイルパスでファイルを読み込むこと", async () => {
      const readFileSpy = vi.spyOn(fs, "readFileSync");

      const testResolver = createQueryResolver(
        "testResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("testFunction", () => "test")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      await ResolverProcessor.processResolver(testResolver);

      const expectedPath = path.join(
        getDistDir(),
        "functions",
        "testResolver__testFunction.js",
      );

      expect(readFileSpy).toHaveBeenCalledWith(expectedPath, "utf-8");
    });

    it("複数のステップで異なるファイルパスを使用すること", async () => {
      const readFileSpy = vi.spyOn(fs, "readFileSync");

      const testResolver = createQueryResolver(
        "multiStepResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("step1", () => "step1")
        .sqlStep("step2", async () => "SELECT 1")
        .fnStep("step3", () => "step3")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      await ResolverProcessor.processResolver(testResolver);

      const expectedPaths = [
        path.join(getDistDir(), "functions", "multiStepResolver__step1.js"),
        path.join(getDistDir(), "functions", "multiStepResolver__step2.js"),
        path.join(getDistDir(), "functions", "multiStepResolver__step3.js"),
      ];

      expectedPaths.forEach((expectedPath) => {
        expect(readFileSpy).toHaveBeenCalledWith(expectedPath, "utf-8");
      });
    });
  });

  describe("異なるリゾルバー形式での動作テスト", () => {
    it("fnのみのResolverを正しく処理すること", async () => {
      const fnOnlyResolver = createQueryResolver(
        "fnOnlyResolver",
        t.type({ id: t.string() }),
      )
        .fnStep("process", () => "processed")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(fnOnlyResolver);

      expect(result.pipelines).toHaveLength(1);
      expect(result.pipelines[0].operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
    });

    it("sqlのみのResolverを正しく処理すること", async () => {
      const sqlOnlyResolver = createQueryResolver(
        "sqlOnlyResolver",
        t.type({ id: t.string() }),
      )
        .sqlStep("query", async () => "SELECT 1")
        .returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(sqlOnlyResolver);

      expect(result.pipelines).toHaveLength(1);
      expect(result.pipelines[0].operationType).toBe(
        PipelineResolver_OperationType.FUNCTION,
      );
    });

    it("ステップが空のResolverを正しく処理すること", async () => {
      const emptyResolver = createQueryResolver(
        "emptyResolver",
        t.type({ id: t.string() }),
      ).returns(() => ({ result: "test" }), t.type({ result: t.string() }));

      const result = await ResolverProcessor.processResolver(emptyResolver);

      expect(result.pipelines).toHaveLength(0);
    });
  });
});
