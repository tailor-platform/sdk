import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { assertDefined } from "#/utils/assert";
import { seedPlugin } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";

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
});
