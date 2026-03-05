import path from "node:path";
import { createImportMain, setupTailordbMock } from "@tailor-platform/sdk/test";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const outputDir = path.join(__dirname, "../.tailor-sdk");

describe("bundled resolver execution", () => {
  let executedQueries: { query: string; params: unknown[] }[];

  const importMain = createImportMain(outputDir);

  beforeAll(() => {
    ({ executedQueries } = setupTailordbMock());
  });

  beforeEach(() => {
    executedQueries.length = 0;
  });

  describe("add resolver", () => {
    test("returns sum of inputs", async () => {
      const main = await importMain("resolvers/add.js");
      const result = await main({ input: { left: 3, right: 4 } });
      expect(result).toBe(7);
    });
  });

  describe("incrementUserAge resolver", () => {
    test("increments user age with DB mock", async () => {
      setupTailordbMock((query) => {
        if (query.includes("SELECT") || query.includes("select")) {
          return [{ age: 30 }];
        }
        return [];
      });

      const main = await importMain("resolvers/incrementUserAge.js");
      const result = await main({ input: { email: "test@example.com" } });
      expect(result).toEqual({ oldAge: 30, newAge: 31 });
    });
  });

  describe("decrementUserAge resolver", () => {
    test("decrements user age with DB mock", async () => {
      setupTailordbMock((query) => {
        if (query.includes("SELECT") || query.includes("select")) {
          return [
            {
              id: "user-1",
              email: "test@example.com",
              name: "Test",
              age: 30,
              createdAt: null,
              updatedAt: null,
            },
          ];
        }
        return [];
      });

      const main = await importMain("resolvers/decrementUserAge.js");
      const result = await main({ input: { email: "test@example.com" } });
      expect(result).toEqual({ oldAge: 30, newAge: 29 });
    });
  });

  describe("showUserInfo resolver", () => {
    test("returns user info from context", async () => {
      const main = await importMain("resolvers/showUserInfo.js");
      const result = await main({
        user: {
          id: "test-id",
          type: "machine_user",
          workspaceId: "ws-id",
          attributes: { role: "admin" },
          attributeList: [],
        },
      });
      expect(result).toEqual({
        userId: "test-id",
        userType: "machine_user",
        workspaceId: "ws-id",
      });
    });
  });

  describe("showEnv resolver", () => {
    test("returns env values embedded from config", async () => {
      const main = await importMain("resolvers/showEnv.js");
      const result = await main({ env: { appName: "Resolver Template", version: 1 } });
      expect(result).toEqual({
        appName: "Resolver Template",
        version: 1,
      });
    });
  });
});
