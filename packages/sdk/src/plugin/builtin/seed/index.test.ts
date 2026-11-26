import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { assertDefined } from "#/utils/assert";
import { seedPlugin } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { GeneratorAuthInput } from "#/plugin/types";

describe("seedPlugin", () => {
  test("generates the schema files and their imports in a relative distPath under the config's directory", async () => {
    const configPath = "/proj/app/tailor.config.ts";
    const plugin = seedPlugin({ distPath: "./seed" });
    const onTailorDBReady = assertDefined(plugin.onTailorDBReady, "onTailorDBReady missing");

    const result = await onTailorDBReady({
      tailordb: [
        {
          namespace: "main",
          tables: {
            User: { name: "User", fields: { id: { config: {} } } } as unknown as TailorDBType,
          },
          sourceInfo: new Map([
            ["User", { filePath: "/proj/app/tailordb/user.ts", exportName: "user" }],
          ]),
          pluginAttachments: new Map(),
        },
      ],
      auths: {},
      baseDir: "/proj/.tailor/generated/seed",
      configPath,
      pluginConfig: { distPath: "./seed" },
    });

    const schema = assertDefined(
      result.files.find((file) => file.path.endsWith("User.schema.ts")),
      "User schema file missing",
    );
    expect(path.resolve(path.dirname(configPath), schema.path)).toBe(
      "/proj/app/seed/data/User.schema.ts",
    );
    expect(schema.content).toContain('from "../../tailordb/user"');
  });

  test("names the data and schema files of a table several namespaces define after its namespace", async () => {
    const configPath = "/proj/app/tailor.config.ts";
    const table = (name: string, fields: Record<string, unknown> = {}) =>
      ({ name, fields: { id: { config: {} }, ...fields } }) as unknown as TailorDBType;
    const plugin = seedPlugin({ distPath: "./seed" });

    const result = await assertDefined(
      plugin.onTailorDBReady,
      "onTailorDBReady missing",
    )({
      tailordb: [
        {
          namespace: "shop-db",
          tables: {
            Customer: table("Customer"),
            Order: table("Order", {
              customerId: { config: {}, relation: { targetType: "Customer", key: "id" } },
            }),
          },
          sourceInfo: new Map([
            ["Customer", { filePath: "/proj/app/shop/customer.ts", exportName: "customer" }],
            ["Order", { filePath: "/proj/app/shop/order.ts", exportName: "order" }],
          ]),
          pluginAttachments: new Map(),
        },
        {
          namespace: "crm-db",
          tables: { Customer: table("Customer", { email: { config: {} } }) },
          sourceInfo: new Map([
            ["Customer", { filePath: "/proj/app/crm/customer.ts", exportName: "customer" }],
          ]),
          pluginAttachments: new Map(),
        },
      ],
      auths: {
        "crm-auth": {
          name: "crm-auth",
          idProvider: { kind: "BuiltInIdP", namespace: "crm-idp" },
          userProfile: { tableName: "Customer", namespace: "crm-db", usernameField: "email" },
        } as unknown as GeneratorAuthInput,
      },
      baseDir: "/proj/.tailor/generated/seed",
      configPath,
      pluginConfig: { distPath: "./seed" },
    });

    const files = new Map(result.files.map((file) => [path.basename(file.path), file.content]));
    expect([...files.keys()].toSorted()).toEqual([
      "Order.jsonl",
      "Order.schema.ts",
      "_User.jsonl",
      "_User.schema.ts",
      "crm-db.Customer.jsonl",
      "crm-db.Customer.schema.ts",
      "shop-db.Customer.jsonl",
      "shop-db.Customer.schema.ts",
    ]);
    expect(files.get("Order.schema.ts")).toContain(
      '{"column":"customerId","references":{"table":"shop-db.Customer","column":"id"}}',
    );
    expect(files.get("crm-db.Customer.schema.ts")).toContain('"table":"_User"');
    expect(files.get("shop-db.Customer.schema.ts")).not.toContain('"table":"_User"');
    expect(files.get("_User.schema.ts")).toContain('table: "crm-db.Customer"');
  });

  const builtInIdpAuth = (name: string, idp: string) =>
    ({
      name,
      idProvider: { kind: "BuiltInIdP", namespace: idp },
      userProfile: { tableName: "User", usernameField: "email" },
    }) as unknown as GeneratorAuthInput;
  const run = (auths: Record<string, GeneratorAuthInput>) => {
    const plugin = seedPlugin({ distPath: "./seed" });
    return assertDefined(
      plugin.onTailorDBReady,
      "onTailorDBReady missing",
    )({
      tailordb: [],
      auths,
      baseDir: "/proj/.tailor/generated/seed",
      configPath: "/proj/app/tailor.config.ts",
      pluginConfig: { distPath: "./seed" },
    });
  };

  test("generates the IdP user files from the only Auth service that uses a built-in IdP", async () => {
    const result = await run({
      "shop-auth": builtInIdpAuth("shop-auth", "shop-idp"),
      "admin-auth": { name: "admin-auth" },
    });

    expect(result.files.map((file) => path.basename(file.path))).toContain("_User.schema.ts");
  });

  test("rejects a config whose Auth services use several built-in IdPs", async () => {
    await expect(
      run({
        "shop-auth": builtInIdpAuth("shop-auth", "shop-idp"),
        "admin-auth": builtInIdpAuth("admin-auth", "admin-idp"),
      }),
    ).rejects.toMatchObject({
      code: "SEED_IDP_USER_AUTH_AMBIGUOUS",
      context: { auths: ["shop-auth", "admin-auth"] },
    });
  });
});
