import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { seedPlugin } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBReadyContext } from "#/plugin/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name]!;
}

type SeedPluginConfig = NonNullable<ReturnType<typeof seedPlugin>["pluginConfig"]>;

async function generateTestExecScript(): Promise<string> {
  const customer = parseTailorDBType(
    toSchemaOutput(
      db.type("Customer", {
        name: db.string(),
      }),
    ),
  );
  const context: TailorDBReadyContext<SeedPluginConfig> = {
    tailordb: [
      {
        namespace: "tailordb",
        types: { Customer: customer },
        sourceInfo: new Map([
          ["Customer", { filePath: "/test/customer.ts", exportName: "Customer" }],
        ]),
        pluginAttachments: new Map(),
      },
    ],
    auth: {
      name: "main-auth",
      idProvider: {
        name: "builtin-idp",
        kind: "BuiltInIdP",
        namespace: "builtin-idp",
        clientName: "default",
      },
      userProfile: {
        typeName: "Customer",
        namespace: "tailordb",
        usernameField: "name",
      },
    },
    baseDir: "/test",
    configPath: "/test/tailor.config.ts",
    pluginConfig: { distPath: "/test/seed", machineUserName: "manager" },
  };
  const result = await seedPlugin(context.pluginConfig).onTailorDBReady!(context);
  const execFile = result.files.find((file) => file.path === "/test/seed/exec.mjs");
  if (!execFile) throw new Error("Generated exec.mjs was not found");
  return execFile.content;
}

function getNormalizedBlock(script: string, declaration: string, lineCount: number): string {
  const lines = script.split("\n");
  const start = lines.findIndex((line) => line.trimStart() === declaration);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = lines.slice(start, start + lineCount);
  const baseIndent = block[0]?.match(/^\s*/)?.[0].length ?? 0;
  return block.map((line) => line.slice(baseIndent)).join("\n");
}

describe("generateExecScript", () => {
  test("preserves indentation after embedding the seed data loader", async () => {
    const script = await generateTestExecScript();

    expect(script).toMatch(/^\/\*\*/);
    expect(getNormalizedBlock(script, "const namespaceEntities = {", 5)).toBe(
      `const namespaceEntities = {
  "tailordb": [
    "Customer",
  ]
};`,
    );
    expect(getNormalizedBlock(script, "const namespaceDeps = {", 5)).toBe(
      `const namespaceDeps = {
  "tailordb": {
    "Customer": []
  }
};`,
    );
    expect(getNormalizedBlock(script, "const namespaceSelfRefTypes = {", 3)).toBe(
      `const namespaceSelfRefTypes = {
  "tailordb": []
};`,
    );
    expect(getNormalizedBlock(script, "const requiredFieldsByType = {", 3)).toBe(
      `const requiredFieldsByType = {
  "Customer": ["name"]
};`,
    );
  });

  test("validates selected seed data before truncation, catches errors, and reuses it", async () => {
    const script = await generateTestExecScript();
    const preloadStartIndex = script.indexOf("let tailorDbSeedData;");
    const preloadIndex = script.indexOf(
      "tailorDbSeedData = loadSelectedTailorDbSeedData();",
      preloadStartIndex,
    );
    const preloadTryIndex = script.lastIndexOf("try {", preloadIndex);
    const preloadCatchIndex = script.indexOf("} catch (error) {", preloadIndex);
    const truncateIndex = script.indexOf("// Truncate tables if requested");
    const mainTryIndex = script.indexOf("// Main execution\ntry {");
    const defaultLoadIndex = script.indexOf(
      "tailorDbSeedData ??= loadSelectedTailorDbSeedData();",
      mainTryIndex,
    );
    const seedFunctionStartIndex = script.indexOf("const seedViaTestExecScript");
    const idpFunctionStartIndex = script.indexOf("// Seed _User via tailor.idp.Client");
    const seedFunction = script.slice(seedFunctionStartIndex, idpFunctionStartIndex);

    expect(preloadStartIndex).toBeGreaterThanOrEqual(0);
    expect(preloadTryIndex).toBeGreaterThan(preloadStartIndex);
    expect(preloadIndex).toBeGreaterThan(preloadTryIndex);
    expect(preloadCatchIndex).toBeGreaterThan(preloadIndex);
    expect(truncateIndex).toBeGreaterThan(preloadIndex);
    expect(defaultLoadIndex).toBeGreaterThan(mainTryIndex);
    expect(seedFunction).not.toContain("loadSeedData(");
    expect(script.match(/loadSeedData\(/g)).toHaveLength(2);
  });

  test("keeps default IdP output and aggregates skipped TailorDB rows", async () => {
    const script = await generateTestExecScript();

    expect(script).toContain("const message = values.upsert");
    expect(script).toContain("${parsed.processed || 0} rows processed");
    expect(script).toContain("skipped: Number(counts.skipped) || 0");
    expect(script).toContain("current.skipped > 0");
  });
});

describe("seedPlugin", () => {
  test("generates an exec script that bundles relative to the Tailor config directory", async () => {
    const distPath = "/workspace/generated/seed";
    const configPath = "/workspace/config/tailor.config.ts";
    const plugin = seedPlugin({ distPath });
    const context: TailorDBReadyContext<{ distPath: string }> = {
      tailordb: [],
      auth: undefined,
      baseDir: "/workspace",
      configPath,
      pluginConfig: { distPath },
    };

    const result = await plugin.onTailorDBReady!(context);
    const execScript = result.files.find((file) => file.path.endsWith("/exec.mjs"));

    expect(execScript?.content).toContain(
      "bundleSeedScript(namespace, typesWithData, dirname(configPath))",
    );
  });
});
