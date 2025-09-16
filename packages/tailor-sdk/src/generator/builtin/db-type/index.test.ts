import { describe, test, expect } from "vitest";
import { DbTypeGenerator, DbTypeGeneratorID } from "./index";
import { db } from "@/services/tailordb/schema";

describe("DbTypeGenerator", () => {
  const mockDistPath = ({ tailorDB }: { app: string; tailorDB: string }) =>
    `db/${tailorDB}.ts`;

  test("ジェネレータの基本プロパティ", () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    expect(generator.id).toBe(DbTypeGeneratorID);
    expect(generator.description).toContain("TypeScript type definitions");
  });

  test("単一型の処理", async () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    const mockType = db.type("User", {
      name: db.string({ optional: true }),
    });
    const result = await generator.processType({
      type: mockType,
      applicationNamespace: "test-app",
      namespace: "test-namespace",
    });

    expect(result.name).toBe("User");
    expect(result.typeDef).toContain("export type User = {");
    expect(result.typeDef).toContain("id: string;");
    expect(result.typeDef).toContain("name?: string | null;");
  });

  test("リゾルバー処理（未使用）", () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    const result = generator.processResolver();

    expect(result).toBeUndefined();
  });

  test("名前空間処理", async () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    const mockTypes = {
      User: {
        name: "User",
        typeDef: "export type User = { id: string; }",
      },
      UserSetting: {
        name: "UserSetting",
        typeDef: "export type UserSetting = { id: string; }",
      },
    };

    const result = await generator.processTailorDBNamespace({
      applicationNamespace: "app",
      namespace: "ns",
      types: mockTypes,
    });

    expect(result).toContain("export type User = { id: string; }");
    expect(result).toContain("export type UserSetting = { id: string; }");
  });

  test("集約処理", () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    const mockInputs = [
      {
        applicationNamespace: "app1",
        tailordb: [
          {
            namespace: "main",
            types: "export type User = { id: string; }",
          },
        ],
        pipeline: [],
      },
    ];

    const result = generator.aggregate({
      inputs: mockInputs,
      executorInputs: [],
      baseDir: "/test",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("db/main.ts");
    expect(result.files[0].content).toBe("export type User = { id: string; }");
  });

  test("複数アプリケーション・複数名前空間の集約", () => {
    const generator = new DbTypeGenerator({ distPath: mockDistPath });

    const mockInputs = [
      {
        applicationNamespace: "app1",
        tailordb: [
          {
            namespace: "main",
            types: "export type User = { id: string; }",
          },
          {
            namespace: "secondary",
            types: "export type Product = { id: string; }",
          },
        ],
        pipeline: [],
      },
      {
        applicationNamespace: "app2",
        tailordb: [
          {
            namespace: "main",
            types: "export type Order = { id: string; }",
          },
        ],
        pipeline: [],
      },
    ];

    const result = generator.aggregate({
      inputs: mockInputs,
      executorInputs: [],
      baseDir: "/test",
    });

    expect(result.files).toHaveLength(3);

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("db/main.ts");
    expect(paths).toContain("db/secondary.ts");

    const mainFile = result.files.find((f) => f.path === "db/main.ts");
    expect(mainFile?.content).toContain("User");
  });
});
