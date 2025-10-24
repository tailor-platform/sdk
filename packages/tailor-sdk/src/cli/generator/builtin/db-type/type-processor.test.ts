import { describe, test, expect } from "vitest";
import { TypeProcessor } from "./type-processor";
import { db } from "@/configure/services/tailordb/schema";
import { TailorDBService } from "@/cli/application/tailordb/service";

describe("TypeProcessor", () => {
  test("基本型の変換", async () => {
    const user = db.type("User", {
      name: db.string({ optional: true }),
      age: db.int({ optional: true }),
      active: db.bool({ optional: true }),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { User: user };
    service["parseTypes"]();
    const types = service.getTypes();
    const result = await TypeProcessor.processType(types.User);

    expect(result.name).toBe("User");
    expect(result.typeDef).toContain("export type User = {");
    expect(result.typeDef).toContain("id: string;");
    expect(result.typeDef).toContain("name?: string | null;");
    expect(result.typeDef).toContain("age?: number | null;");
    expect(result.typeDef).toContain("active?: boolean | null;");
  });

  test("enum型の変換", async () => {
    const userSetting = db.type("UserSetting", {
      language: db.enum("jp", "en"),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { UserSetting: userSetting };
    service["parseTypes"]();
    const types = service.getTypes();
    const result = await TypeProcessor.processType(types.UserSetting);

    expect(result.typeDef).toContain('language: "jp" | "en";');
  });

  test("リレーション型の変換", async () => {
    const user = db.type("User", {
      name: db.string(),
    });

    const userSetting = db.type("UserSetting", {
      userID: db.uuid().relation({
        type: "1-1",
        toward: { type: user },
        backward: "setting",
      }),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { User: user, UserSetting: userSetting };
    service["parseTypes"]();
    const types = service.getTypes();
    const result = await TypeProcessor.processType(types.UserSetting);

    // Verify that both the foreign key itself and the referenced object are generated
    console.log("Generated typeDef:", result.typeDef);
    expect(result.typeDef).toContain("userID: string;");
    expect(result.typeDef).toContain("user: User;");
  });

  test("複数型の処理と相互参照", async () => {
    const user = db.type("User", {
      name: db.string({ optional: true }),
    });

    const userSetting = db.type("UserSetting", {
      language: db.enum("jp", "en", { optional: true }),
      userID: db.uuid().relation({
        type: "1-1",
        toward: { type: user },
        backward: "setting",
      }),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { User: user, UserSetting: userSetting };
    service["parseTypes"]();
    const types = service.getTypes();

    const processedTypes = {
      User: await TypeProcessor.processType(types.User),
      UserSetting: await TypeProcessor.processType(types.UserSetting),
    };
    const result = await TypeProcessor.processTypes(processedTypes);

    expect(result).toContain("export type User = {");
    expect(result).toContain("export type UserSetting = {");
    expect(result).toContain("setting?: UserSetting | null;");
    expect(result).toContain("user: User;");
  });

  test("逆参照フィールドの生成（1-1関係）", async () => {
    const user = db.type("User", {
      name: db.string({ optional: true }),
    });

    const userSetting = db.type("UserSetting", {
      language: db.enum("jp", "en"),
      userID: db.uuid().relation({
        type: "1-1",
        toward: { type: user },
        backward: "setting",
      }),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { User: user, UserSetting: userSetting };
    service["parseTypes"]();
    const types = service.getTypes();

    const processedTypes = {
      User: await TypeProcessor.processType(types.User),
      UserSetting: await TypeProcessor.processType(types.UserSetting),
    };
    const result = await TypeProcessor.processTypes(processedTypes);

    // Verify that back-reference field "setting" is added to User
    expect(result).toContain("export type User = {");
    expect(result).toContain("id: string;");
    expect(result).toContain("name?: string | null;");
    expect(result).toContain("setting?: UserSetting | null;");

    // Verify that UserSetting also contains the correct fields
    expect(result).toContain("export type UserSetting = {");
    expect(result).toContain('language: "jp" | "en";');
  });

  test("逆参照フィールドの生成（n-1関係）", async () => {
    const user = db.type("User", {});

    const order = db.type("Order", {
      userID: db.uuid().relation({
        type: "n-1",
        toward: { type: user },
        backward: "orders",
      }),
    });

    const service = new TailorDBService("test", { files: [] });
    service["rawTypes"]["test.ts"] = { User: user, Order: order };
    service["parseTypes"]();
    const types = service.getTypes();

    const processedTypes = {
      User: await TypeProcessor.processType(types.User),
      Order: await TypeProcessor.processType(types.Order),
    };
    const result = await TypeProcessor.processTypes(processedTypes);

    // Verify that back-reference field "orders" is added to User as an array
    expect(result).toContain("export type User = {");
    expect(result).toContain("orders?: Order[] | null;");
  });
});
