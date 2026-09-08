import { describe, expect, test } from "vitest";
import { buildSeedNamespaceConfigs } from "./seed-type-processor";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData } from "#/plugin/types";

/**
 * Build a minimal TailorDB type for seed processor tests.
 * @param name - Table name
 * @param fields - Field configs, keyed by field name
 * @returns A type usable wherever a parsed TailorDB table is expected
 */
function makeType(name: string, fields: TailorDBType["fields"]): TailorDBType {
  return { name, fields } as TailorDBType;
}

function makeNamespace(namespace: string, types: TailorDBType[]): TailorDBNamespaceData {
  return {
    namespace,
    tables: Object.fromEntries(types.map((type) => [type.name, type])),
    sourceInfo: new Map(
      types.map((type) => [type.name, { filePath: `/src/${type.name}.ts`, exportName: type.name }]),
    ),
    pluginAttachments: new Map(),
  };
}

describe("buildSeedNamespaceConfigs", () => {
  test("omits a serial field with no incoming relation", () => {
    const user = makeType("User", {
      id: { name: "id", config: { type: "string" } },
      code: { name: "code", config: { type: "integer", serial: { start: 1 } } },
    });

    const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user])]);

    expect(config?.omitFields?.User).toEqual(["code"]);
  });

  test("keeps a serial field that another table's relation is keyed to", () => {
    const user = makeType("User", {
      id: { name: "id", config: { type: "string" } },
      code: { name: "code", config: { type: "integer", serial: { start: 1 } } },
    });
    const order = makeType("Order", {
      id: { name: "id", config: { type: "string" } },
      user: {
        name: "user",
        config: { type: "string" },
        relation: {
          targetType: "User",
          forwardName: "user",
          backwardName: "orders",
          key: "code",
          unique: false,
        },
      },
    });

    const [config] = buildSeedNamespaceConfigs([makeNamespace("tailordb", [user, order])]);

    // `code` is serial, so it would normally be dropped from the dump, but
    // Order.user is keyed to it: dropping it would leave apply --truncate
    // assigning User a fresh `code` while Order still points at the old one.
    expect(config?.omitFields?.User).toEqual([]);
    expect(config?.omitFields?.Order).toEqual([]);
  });
});
