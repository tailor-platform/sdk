import { describe, it, expect, beforeEach } from "vitest";
import { KyselyGenerator } from "./index";
import { db } from "@/services/tailordb/schema";

const mockBasicType = db.type("User", {
  name: db.string().description("User name"),
  email: db.string().description("User email"),
  age: db.int({ optional: true }),
  isActive: db.bool(),
  score: db.float({ optional: true }),
  birthDate: db.date({ optional: true }),
  lastLogin: db.datetime({ optional: true }),
  tags: db.string({ array: true }),
  ...db.fields.timestamps(),
});

const mockEnumType = db.type("Status", {
  status: db.enum(
    { value: "active" },
    { value: "inactive" },
    { value: "pending" },
  ),
  priority: db.enum(
    { value: "high" },
    { value: "medium" },
    { value: "low" },
    { optional: true },
  ),
});

const mockNestedType = db.type("ComplexUser", {
  profile: db.object({
    firstName: db.string(),
    lastName: db.string(),
  }),
  preferences: db.object(
    {
      key: db.string(),
      value: db.string(),
    },
    { optional: true, array: true },
  ),
  ...db.fields.timestamps(),
});

describe("KyselyGenerator統合テスト", () => {
  let kyselyGenerator: KyselyGenerator;
  const testDistPath = "/test/dist/kysely-types.ts";

  beforeEach(() => {
    kyselyGenerator = new KyselyGenerator({ distPath: () => testDistPath });
  });

  describe("基本的な動作テスト", () => {
    it("processType メソッドが基本的な TailorDBType を正しく処理する", async () => {
      const result = await kyselyGenerator.processType({
        type: mockBasicType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.name).toBe("User");
      expect(result.typeDef).toContain("export interface User {");
      expect(result.typeDef).toContain("id: Generated<string>;");
      expect(result.typeDef).toContain("name: string;");
      expect(result.typeDef).toContain("email: string;");
      expect(result.typeDef).toContain("age: number | null;");
      expect(result.typeDef).toContain("isActive: boolean;");
      expect(result.typeDef).toContain("score: number | null;");
      expect(result.typeDef).toContain("birthDate: Timestamp | null;");
      expect(result.typeDef).toContain("lastLogin: Timestamp | null;");
      expect(result.typeDef).toContain("tags: string[];");
      expect(result.typeDef).toContain("createdAt: Timestamp | null;");
      expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
    });

    it("processResolver メソッドが undefined を返す", () => {
      const result = kyselyGenerator.processResolver();
      expect(result).toBeUndefined();
    });
  });

  describe("型マッピングのテスト", () => {
    it("enum型を正しくKysely型にマッピングする", async () => {
      const result = await kyselyGenerator.processType({
        type: mockEnumType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain(
        'status: "active" | "inactive" | "pending";',
      );
      expect(result.typeDef).toContain(
        'priority: "high" | "medium" | "low" | null;',
      );
    });

    it("ネストしたオブジェクト型を正しく処理する", async () => {
      const result = await kyselyGenerator.processType({
        type: mockNestedType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("export interface ComplexUser {");
      expect(result.typeDef).toContain("profile: {");
      expect(result.typeDef).toContain("firstName: string;");
      expect(result.typeDef).toContain("lastName: string;");
      expect(result.typeDef).toContain("};");
      expect(result.typeDef).toContain("preferences: {");
      expect(result.typeDef).toContain("key: string;");
      expect(result.typeDef).toContain("value: string;");
      expect(result.typeDef).toContain("}[] | null;");
    });

    it("required/optional フィールドを正しく処理する", async () => {
      const testType = db.type("TestRequired", {
        requiredField: db.string(),
        optionalField: db.string({ optional: true }),
        undefinedRequiredField: db.string({ optional: true }),
      });

      const result = await kyselyGenerator.processType({
        type: testType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("requiredField: string;");
      expect(result.typeDef).toContain("optionalField: string | null;");
      expect(result.typeDef).toContain(
        "undefinedRequiredField: string | null;",
      );
    });

    it("配列型を正しく処理する", async () => {
      const arrayType = db.type("ArrayTest", {
        stringArray: db.string({ array: true }),
        optionalIntArray: db.int({ optional: true, array: true }),
      });

      const result = await kyselyGenerator.processType({
        type: arrayType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("stringArray: string[];");
      expect(result.typeDef).toContain("optionalIntArray: number[] | null;");
    });
  });

  describe("processTailorDBNamespace メソッドのテスト", () => {
    it("複数の型を統合してKysely型定義ファイルを生成する", async () => {
      const typeMetadata = {
        User: {
          name: "User",
          typeDef: `export interface User {
  id: Generated<string>;
  name: string;
  email: string;
}`,
        },
        Post: {
          name: "Post",
          typeDef: `export interface Post {
  id: Generated<string>;
  title: string;
  content: string;
}`,
        },
      };

      const result = await kyselyGenerator.processTailorDBNamespace({
        applicationNamespace: "test-app",
        namespace: "test-namespace",
        types: typeMetadata,
      });

      // Common imports are included
      expect(result).toContain(
        'import { SqlClient } from "@tailor-platform/tailor-sdk";',
      );
      expect(result).toContain("import {");
      expect(result).toContain("ColumnType,");
      expect(result).toContain("DummyDriver,");
      expect(result).toContain("Kysely,");

      // Type definitions are included
      expect(result).toContain("export interface User {");
      expect(result).toContain("export interface Post {");

      // DB interface is generated
      expect(result).toContain("interface DB {");
      expect(result).toContain("User: User;");
      expect(result).toContain("Post: Post;");

      // kyselyWrapper is included
      expect(result).toContain("export async function kyselyWrapper");

      // File ends with newline
      expect(result.endsWith("\n")).toBe(true);
    });

    it("空の型定義でも正常に動作する", async () => {
      const result = await kyselyGenerator.processTailorDBNamespace({
        applicationNamespace: "test-app",
        namespace: "test-namespace",
        types: {},
      });

      expect(result).toContain(
        'import { SqlClient } from "@tailor-platform/tailor-sdk";',
      );
      expect(result).toContain("interface DB {");
      expect(result).toContain("export async function kyselyWrapper");
      expect(result.endsWith("\n")).toBe(true);
    });
  });

  describe("aggregate関数のテスト", () => {
    it("型定義を統合してファイル生成結果を返す", () => {
      const processedTypes = `import { SqlClient } from "@tailor-platform/tailor-sdk";

export interface User {
  id: Generated<string>;
  name: string;
  email: string;
}

interface DB {
  User: User;
}

export async function kyselyWrapper() {}
`;

      const inputs = [
        {
          applicationNamespace: "test-app",
          tailordb: [
            {
              namespace: "test-namespace",
              types: processedTypes,
            },
          ],
          pipeline: [],
        },
      ];
      const result = kyselyGenerator.aggregate({
        inputs: inputs,
        executorInputs: [],
        baseDir: "/test",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(testDistPath);
      expect(result.files[0].content).toBe(processedTypes);
      expect(result.errors).toBeUndefined();
    });

    it("複数の型を持つ完全な統合テスト", async () => {
      const types = {
        User: await kyselyGenerator.processType({
          type: mockBasicType,
          applicationNamespace: "test-app",
          namespace: "test-namespace",
        }),
        Status: await kyselyGenerator.processType({
          type: mockEnumType,
          applicationNamespace: "test-app",
          namespace: "test-namespace",
        }),
      };

      const processedTypes = await kyselyGenerator.processTailorDBNamespace({
        applicationNamespace: "test-app",
        namespace: "test-namespace",
        types: types,
      });
      const inputs = [
        {
          applicationNamespace: "test-app",
          tailordb: [
            {
              namespace: "test-namespace",
              types: processedTypes,
            },
          ],
          pipeline: [],
        },
      ];
      const result = kyselyGenerator.aggregate({
        inputs: inputs,
        executorInputs: [],
        baseDir: "/test",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(testDistPath);

      const content = result.files[0].content;
      expect(content).toContain("export interface User {");
      expect(content).toContain("export interface Status {");
      expect(content).toContain("interface DB {");
      expect(content).toContain("User: User;");
      expect(content).toContain("Status: Status;");
    });
  });

  describe("エラーハンドリングのテスト", () => {
    it("無効な型定義でエラーが発生しても適切に処理する", async () => {
      const invalidType = {
        name: "Invalid",
        fields: null, // Invalid field
        options: {},
        referenced: [],
        metadata: {} as any,
        hooks: {} as any,
        _output: {} as any,
      } as any;

      await expect(
        kyselyGenerator.processType({
          type: invalidType,
          applicationNamespace: "test-app",
          namespace: "test-namespace",
        }),
      ).rejects.toThrow();
    });

    it("未知の型定義を文字列型として処理する", async () => {
      const unknownType = db.type("UnknownType", {
        unknownField: db.string(),
      });

      const result = await kyselyGenerator.processType({
        type: unknownType,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("unknownField: string;");
    });
  });

  describe("withTimestamps オプションのテスト", () => {
    it("withTimestamps: true でタイムスタンプフィールドが追加される", async () => {
      const typeWithTimestamps = db.type("WithTimestamp", {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = await kyselyGenerator.processType({
        type: typeWithTimestamps,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).toContain("createdAt: Timestamp | null;");
      expect(result.typeDef).toContain("updatedAt: Timestamp | null;");
    });

    it("withTimestamps: false でタイムスタンプフィールドが追加されない", async () => {
      const typeWithoutTimestamps = db.type("WithoutTimestamp", {
        name: db.string(),
      });

      const result = await kyselyGenerator.processType({
        type: typeWithoutTimestamps,
        applicationNamespace: "test-app",
        namespace: "test-namespace",
      });

      expect(result.typeDef).not.toContain("createdAt");
      expect(result.typeDef).not.toContain("updatedAt");
    });
  });
});
