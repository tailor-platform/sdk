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
