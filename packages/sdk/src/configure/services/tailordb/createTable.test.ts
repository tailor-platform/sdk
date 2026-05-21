import { describe, it, expectTypeOf, expect } from "vitest";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutputs } from "@/utils/test/internal";
import { createTable, timestampFields } from "./createTable";
import { unsafeAllowAllGqlPermission } from "./permission";
import { db } from "./schema";
import type { output } from "@/types/helpers";

describe("createTable basic field type tests", () => {
  it("string field outputs string type correctly", () => {
    const result = createTable("Test", {
      name: { kind: "string" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it("int field outputs number type correctly", () => {
    const result = createTable("Test", {
      age: { kind: "int" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      age: number;
    }>();
  });

  it("bool field outputs boolean type correctly", () => {
    const result = createTable("Test", {
      active: { kind: "bool" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      active: boolean;
    }>();
  });

  it("float field outputs number type correctly", () => {
    const result = createTable("Test", {
      price: { kind: "float" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      price: number;
    }>();
  });

  it("uuid field outputs string type correctly", () => {
    const result = createTable("Test", {
      ref: { kind: "uuid" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      ref: string;
    }>();
  });

  it("date field outputs string type correctly", () => {
    const result = createTable("Test", {
      birthDate: { kind: "date" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  it("datetime field outputs string | Date type correctly", () => {
    const result = createTable("Test", {
      timestamp: { kind: "datetime" },
    });
    expectTypeOf<output<typeof result>>().toMatchObjectType<{
      timestamp: string | Date;
    }>();
  });

  it("time field outputs string type correctly", () => {
    const result = createTable("Test", {
      openingTime: { kind: "time" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });

  it("decimal field outputs string type correctly", () => {
    const result = createTable("Test", {
      amount: { kind: "decimal" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      amount: string;
    }>();
  });
});

describe("createTable optional and array tests", () => {
  it("optional generates nullable type", () => {
    const result = createTable("Test", {
      description: { kind: "string", optional: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  it("array generates array type", () => {
    const result = createTable("Test", {
      tags: { kind: "string", array: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  it("optional array works correctly", () => {
    const result = createTable("Test", {
      items: { kind: "string", optional: true, array: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });
});

describe("createTable enum tests", () => {
  it("enum literal types are inferred", () => {
    const result = createTable("Test", {
      role: { kind: "enum", values: ["MANAGER", "STAFF"] },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      role: "MANAGER" | "STAFF";
    }>();
  });

  it("optional enum works correctly", () => {
    const result = createTable("Test", {
      priority: { kind: "enum", values: ["high", "medium", "low"], optional: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum metadata has correct allowedValues", () => {
    const result = createTable("Test", {
      status: { kind: "enum", values: ["active", "inactive"] },
    });
    expect(result.fields.status.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
    ]);
  });
});

describe("createTable runtime metadata tests", () => {
  it("unique sets metadata correctly", () => {
    const result = createTable("Test", {
      email: { kind: "string", unique: true },
    });
    expect(result.fields.email.metadata.unique).toBe(true);
    expect(result.fields.email.metadata.index).toBe(true);
  });

  it("index sets metadata correctly", () => {
    const result = createTable("Test", {
      name: { kind: "string", index: true },
    });
    expect(result.fields.name.metadata.index).toBe(true);
    expect(result.fields.name.metadata.unique).toBeUndefined();
  });

  it("vector sets metadata correctly", () => {
    const result = createTable("Test", {
      embedding: { kind: "string", vector: true },
    });
    expect(result.fields.embedding.metadata.vector).toBe(true);
  });

  it("serial sets metadata correctly", () => {
    const result = createTable("Test", {
      code: { kind: "string", serial: { start: 1, format: "INV-%05d" } },
    });
    expect(result.fields.code.metadata.serial).toEqual({
      start: 1,
      format: "INV-%05d",
    });
  });

  it("description sets metadata correctly", () => {
    const result = createTable("Test", {
      name: { kind: "string", description: "The user's name" },
    });
    expect(result.fields.name.metadata.description).toBe("The user's name");
  });

  it("decimal scale sets metadata correctly", () => {
    const result = createTable("Test", {
      amount: { kind: "decimal", scale: 4 },
    });
    expect(result.fields.amount.metadata.scale).toBe(4);
  });

  it("decimal scale rejects out-of-range values", () => {
    expect(() => createTable("Test", { amount: { kind: "decimal", scale: -1 } })).toThrow(
      "scale must be an integer between 0 and 12",
    );
    expect(() => createTable("Test", { amount: { kind: "decimal", scale: 13 } })).toThrow(
      "scale must be an integer between 0 and 12",
    );
    expect(() => createTable("Test", { amount: { kind: "decimal", scale: 1.5 } })).toThrow(
      "scale must be an integer between 0 and 12",
    );
  });

  it("decimal scale accepts boundary values 0 and 12", () => {
    const low = createTable("Test", { amount: { kind: "decimal", scale: 0 } });
    expect(low.fields.amount.metadata.scale).toBe(0);

    const high = createTable("Test", { amount: { kind: "decimal", scale: 12 } });
    expect(high.fields.amount.metadata.scale).toBe(12);
  });
});

describe("createTable relation tests", () => {
  const User = db.type("User", {
    name: db.string(),
  });

  it("n-1 relation sets rawRelation and index", () => {
    const result = createTable("Test", {
      userId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: User },
        },
      },
    });
    expect(result.fields.userId.rawRelation).toBeDefined();
    expect(result.fields.userId.rawRelation!.type).toBe("n-1");
    expect(result.fields.userId.metadata.index).toBe(true);
    expect(result.fields.userId.metadata.unique).toBeUndefined();
  });

  it("oneToOne relation sets rawRelation, index, and unique", () => {
    const result = createTable("Test", {
      userId: {
        kind: "uuid",
        relation: {
          type: "oneToOne",
          toward: { type: User },
        },
      },
    });
    expect(result.fields.userId.rawRelation).toBeDefined();
    expect(result.fields.userId.rawRelation!.type).toBe("oneToOne");
    expect(result.fields.userId.metadata.index).toBe(true);
    expect(result.fields.userId.metadata.unique).toBe(true);
  });

  it("self-referencing relation works", () => {
    const result = createTable("Test", {
      name: { kind: "string" },
      parentId: {
        kind: "uuid",
        optional: true,
        relation: {
          type: "n-1",
          toward: { type: "self" as const },
        },
      },
    });
    expect(result.fields.parentId.rawRelation).toBeDefined();
  });
});

describe("createTable keyOnly relation", () => {
  it("keyOnly relation sets rawRelation and index", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        relation: {
          type: "keyOnly",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetId.rawRelation).toBeDefined();
    expect(result.fields.targetId.rawRelation!.type).toBe("keyOnly");
    expect(result.fields.targetId.metadata.index).toBe(true);
    expect(result.fields.targetId.metadata.unique).toBeUndefined();
  });
});

describe("createTable type-safe options", () => {
  it("permission accepts record operands typed to the type's fields", () => {
    const result = createTable(
      "Employee",
      {
        name: { kind: "string" },
        ownerId: { kind: "uuid" },
      },
      {
        permission: {
          create: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
          read: [{ conditions: [[{ record: "name" }, "=", "admin"]], permit: true }],
          update: [{ conditions: [[{ newRecord: "ownerId" }, "=", { user: "id" }]], permit: true }],
          delete: [{ conditions: [[{ record: "ownerId" }, "=", { user: "id" }]], permit: true }],
        },
      },
    );
    expect(result.metadata.permissions).toBeDefined();
  });

  it("indexes validates field names against the type's fields", () => {
    const result = createTable(
      "Employee",
      {
        name: { kind: "string" },
        department: { kind: "string" },
      },
      {
        indexes: [{ fields: ["name", "department"], unique: true }],
      },
    );
    expect(result.metadata.indexes).toBeDefined();
  });

  it("files accepts keys that do not collide with field names", () => {
    const result = createTable(
      "Employee",
      { name: { kind: "string" } },
      { files: { avatar: "image/png" } },
    );
    expect(result.metadata.files).toBeDefined();
  });
});

describe("createTable array field guards", () => {
  it("array fields do not get index or unique metadata", () => {
    // Runtime guard: buildField skips index/unique for array fields
    const result = createTable("Test", {
      tags: { kind: "string", array: true },
    });
    expect(result.fields.tags.metadata.index).toBeUndefined();
    expect(result.fields.tags.metadata.unique).toBeUndefined();
  });
});

describe("createTable nested object guards", () => {
  it("nested object descriptor inside object descriptor causes type error", () => {
    createTable("Test", {
      address: {
        kind: "object",
        fields: {
          street: { kind: "string" },
          // @ts-expect-error Nested object inside object is not allowed
          location: {
            kind: "object",
            fields: { lat: { kind: "float" }, lng: { kind: "float" } },
          },
        },
      },
    });
  });

  it("nested db.object() inside object descriptor causes type error", () => {
    createTable("Test", {
      address: {
        kind: "object",
        fields: {
          street: { kind: "string" },
          // @ts-expect-error Nested db.object() inside object descriptor is not allowed
          location: db.object({ lat: db.float(), lng: db.float() }),
        },
      },
    });
  });

  it("flat object descriptor is allowed", () => {
    const result = createTable("Test", {
      address: {
        kind: "object",
        fields: {
          street: { kind: "string" },
          city: { kind: "string" },
        },
      },
    });
    expect(result.fields.address.type).toBe("nested");
  });
});

describe("createTable plugins option", () => {
  it("plugins are set on the type via options", () => {
    const result = createTable(
      "Test",
      { name: { kind: "string" } },
      {
        plugins: [{ pluginId: "test-plugin", config: { enabled: true } }],
      },
    );
    expect(result.plugins).toEqual([{ pluginId: "test-plugin", config: { enabled: true } }]);
  });

  it("multiple plugins are set in order", () => {
    const result = createTable(
      "Test",
      { name: { kind: "string" } },
      {
        plugins: [
          { pluginId: "plugin-a", config: { a: 1 } },
          { pluginId: "plugin-b", config: { b: 2 } },
        ],
      },
    );
    expect(result.plugins).toEqual([
      { pluginId: "plugin-a", config: { a: 1 } },
      { pluginId: "plugin-b", config: { b: 2 } },
    ]);
  });
});

describe("createTable relation key validation", () => {
  it("invalid relation key against target type causes type error", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    createTable("Test", {
      // @ts-expect-error 'nonExistent' does not exist on Target fields
      targetId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: Target, key: "nonExistent" },
        },
      },
    });
  });

  it("valid relation key matching target field name is accepted", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: Target, key: "name" },
        },
      },
    });
    expect(result.fields.targetId.rawRelation).toBeDefined();
  });

  it("explicit 'id' relation key is always accepted for target types", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: Target, key: "id" },
        },
      },
    });
    expect(result.fields.targetId.rawRelation!.toward.key).toBe("id");
  });

  it("explicit 'id' relation key is always accepted for self-references", () => {
    const result = createTable("Test", {
      parentId: {
        kind: "uuid",
        optional: true,
        relation: {
          type: "n-1",
          toward: { type: "self" as const, key: "id" },
        },
      },
    });
    expect(result.fields.parentId.rawRelation!.toward.key).toBe("id");
  });

  it("invalid self-referencing relation key causes type error", () => {
    createTable("Test", {
      // @ts-expect-error 'nonExistent' does not exist on own fields
      parentId: {
        kind: "uuid",
        optional: true,
        relation: {
          type: "n-1",
          toward: { type: "self" as const, key: "nonExistent" },
        },
      },
    });
  });

  it("valid self-referencing relation key is accepted", () => {
    const result = createTable("Test", {
      name: { kind: "string" },
      parentId: {
        kind: "uuid",
        optional: true,
        relation: {
          type: "n-1",
          toward: { type: "self" as const, key: "name" },
        },
      },
    });
    expect(result.fields.parentId.rawRelation).toBeDefined();
  });

  it("relation without key is accepted", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetId.rawRelation).toBeDefined();
  });
});

describe("createTable array+vector/serial guards", () => {
  it("array + vector causes type error", () => {
    createTable("Test", {
      // @ts-expect-error array and vector are incompatible
      tags: { kind: "string", array: true, vector: true },
    });
  });

  it("array + serial causes type error", () => {
    createTable("Test", {
      // @ts-expect-error array and serial are incompatible
      codes: { kind: "string", array: true, serial: { start: 1 } },
    });
  });

  it("non-array vector is accepted", () => {
    const result = createTable("Test", {
      embedding: { kind: "string", vector: true },
    });
    expect(result.fields.embedding.metadata.vector).toBe(true);
  });

  it("non-array serial is accepted", () => {
    const result = createTable("Test", {
      code: { kind: "string", serial: { start: 1 } },
    });
    expect(result.fields.code.metadata.serial).toEqual({ start: 1 });
  });
});

describe("createTable unique on many-to-one relation guard", () => {
  it("unique: true on n-1 relation causes type error", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    createTable("Test", {
      // @ts-expect-error unique is not allowed on n-1 relations
      targetId: {
        kind: "uuid",
        unique: true,
        relation: {
          type: "n-1",
          toward: { type: Target },
        },
      },
    });
  });

  it("unique: true on manyToOne relation causes type error", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    createTable("Test", {
      // @ts-expect-error unique is not allowed on manyToOne relations
      targetId: {
        kind: "uuid",
        unique: true,
        relation: {
          type: "manyToOne",
          toward: { type: Target },
        },
      },
    });
  });

  it("unique: true on oneToOne relation is accepted", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        unique: true,
        relation: {
          type: "oneToOne",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetId.metadata.unique).toBe(true);
    expect(result.fields.targetId.metadata.index).toBe(true);
  });

  it("n-1 relation without unique sets index only", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetId.metadata.index).toBe(true);
    expect(result.fields.targetId.metadata.unique).toBeUndefined();
  });
});

describe("createTable array relation index guard", () => {
  it("array relation does not set index or unique metadata", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetIds: {
        kind: "uuid",
        array: true,
        relation: {
          type: "n-1",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetIds.rawRelation).toBeDefined();
    expect(result.fields.targetIds.metadata.index).toBeUndefined();
    expect(result.fields.targetIds.metadata.unique).toBeUndefined();
  });

  it("array oneToOne relation does not set index or unique metadata", () => {
    const Target = createTable("Target", { name: { kind: "string" } });
    const result = createTable("Test", {
      targetIds: {
        kind: "uuid",
        array: true,
        relation: {
          type: "oneToOne",
          toward: { type: Target },
        },
      },
    });
    expect(result.fields.targetIds.rawRelation).toBeDefined();
    expect(result.fields.targetIds.metadata.index).toBeUndefined();
    expect(result.fields.targetIds.metadata.unique).toBeUndefined();
  });
});

describe("createTable id field guard", () => {
  it("defining id field causes type error", () => {
    createTable("Test", {
      // @ts-expect-error id is a system field and cannot be redefined
      id: { kind: "uuid" },
      name: { kind: "string" },
    });
  });
});

describe("createTable unknown descriptor kind", () => {
  it("throws on unknown kind value", () => {
    expect(() =>
      createTable("Test", {
        // @ts-expect-error testing runtime behavior with unknown kind
        name: { kind: "strng" },
      }),
    ).toThrow('Unknown field descriptor kind: "strng"');
  });

  it("throws on enum descriptor without values", () => {
    expect(() =>
      createTable("Test", {
        // @ts-expect-error testing runtime behavior with missing values
        status: { kind: "enum" },
      }),
    ).toThrow('Enum field descriptor requires a non-empty "values" array');
  });

  it("throws on plain object without kind or type", () => {
    expect(() =>
      createTable("Test", {
        // @ts-expect-error testing runtime behavior with malformed entry
        name: { optional: true },
      }),
    ).toThrow("Expected a field descriptor (with `kind`) or a db.*() field instance (with `type`)");
  });
});

describe("createTable mixed fluent and descriptor fields", () => {
  it("accepts both db.field() and descriptor in the same type", () => {
    const result = createTable("Test", {
      name: db.string(),
      email: { kind: "string", unique: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      name: string;
      email: string;
    }>();
    expect(result.fields.email.metadata.unique).toBe(true);
  });
});

describe("timestampFields", () => {
  it("returns createdAt and updatedAt descriptors", () => {
    const result = createTable("Test", {
      name: { kind: "string" },
      ...timestampFields(),
    });
    expect(result.fields.createdAt).toBeDefined();
    expect(result.fields.updatedAt).toBeDefined();
    expect(result.fields.createdAt.metadata.required).toBe(true);
    expect(result.fields.updatedAt.metadata.required).toBe(false);
  });
});

describe("createTable type-level options", () => {
  it("pluralForm via options sets settings.pluralForm", () => {
    const result = createTable("Person", { name: { kind: "string" } }, { pluralForm: "People" });
    expect(result.metadata.settings).toEqual({ pluralForm: "People" });
  });

  it("pluralForm via tuple overload sets settings.pluralForm", () => {
    const result = createTable(["Person", "People"], { name: { kind: "string" } });
    expect(result.metadata.settings).toEqual({ pluralForm: "People" });
  });

  it("type-level description sets metadata.description", () => {
    const result = createTable(
      "Employee",
      { name: { kind: "string" } },
      { description: "Company employee" },
    );
    expect(result.metadata.description).toBe("Company employee");
  });

  it("features sets metadata.settings", () => {
    const result = createTable(
      "Order",
      { total: { kind: "int" } },
      { features: { aggregation: true } },
    );
    expect(result.metadata.settings).toEqual({ aggregation: true });
  });

  it("gqlPermission sets metadata.permissions.gql", () => {
    const result = createTable(
      "Secret",
      { value: { kind: "string" } },
      { gqlPermission: unsafeAllowAllGqlPermission },
    );
    expect(result.metadata.permissions.gql).toBeDefined();
  });
});

describe("createTable record-level hooks/validate options", () => {
  it("options.hooks accepts record-level create/update with full data typing", () => {
    const result = createTable(
      "Test",
      {
        name: { kind: "string" },
        score: { kind: "int" },
      },
      {
        hooks: {
          create: ({ data }) => {
            expectTypeOf(data).toEqualTypeOf<
              Readonly<{ id: string; name: string; score: number }>
            >();
            return { score: data.score + 1 };
          },
          update: ({ data }) => ({ score: data.score + 1 }),
        },
      },
    );
    expect(result.metadata.hooks).toBeDefined();
    expect(result.metadata.hooks?.create).toBeDefined();
    expect(result.metadata.hooks?.update).toBeDefined();
  });

  it("options.validate accepts single function", () => {
    const result = createTable(
      "Test",
      { name: { kind: "string" } },
      {
        validate: ({ data }) => data.name.length > 0,
      },
    );
    expect(result.metadata.validate).toHaveLength(1);
  });

  it("options.validate accepts single [fn, message] tuple", () => {
    const result = createTable(
      "Test",
      { name: { kind: "string" } },
      {
        validate: [({ data }) => data.name.length > 0, "Name must not be empty"],
      },
    );
    expect(result.metadata.validate).toHaveLength(1);
  });

  it("options.validate accepts mixed array of fns and tuples", () => {
    const result = createTable(
      "Test",
      {
        name: { kind: "string" },
        age: { kind: "int" },
      },
      {
        validate: [
          ({ data }) => data.name.length > 0,
          [({ data }) => data.age >= 0, "Age must be non-negative"],
        ],
      },
    );
    expect(result.metadata.validate).toHaveLength(2);
  });

  it("record-level hooks expand into per-field FieldHook entries after parseTypes", () => {
    const type = createTable(
      "Order",
      {
        name: { kind: "string" },
        score: { kind: "int" },
        ...timestampFields(),
      },
      {
        hooks: {
          create: () => ({ score: 0, createdAt: new Date() }),
          update: ({ data }) => ({ score: data.score + 1, updatedAt: new Date() }),
        },
      },
    );

    const types = parseTypes(toSchemaOutputs({ Order: type }), "test", {});
    const parsed = types.Order;

    expect(parsed.fields.score.config.hooks?.create?.expr).toContain("score");
    expect(parsed.fields.score.config.hooks?.update?.expr).toContain("score");
    expect(parsed.fields.createdAt.config.hooks?.create?.expr).toContain("createdAt");
    expect(parsed.fields.createdAt.config.hooks?.update).toBeUndefined();
    expect(parsed.fields.updatedAt.config.hooks?.update?.expr).toContain("updatedAt");
    expect(parsed.fields.updatedAt.config.hooks?.create).toBeUndefined();
    // Fields not present in any hook return literal must stay free of hooks.
    expect(parsed.fields.name.config.hooks?.create).toBeUndefined();
    expect(parsed.fields.name.config.hooks?.update).toBeUndefined();
  });
});
