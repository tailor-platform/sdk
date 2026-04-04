import { describe, it, expectTypeOf, expect } from "vitest";
import { createTable, timestampFields } from "./createTable";
import { unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "./permission";
import { db } from "./schema";
import type { Hook } from "./types";
import type { output } from "@/configure/types/helpers";
import type { FieldValidateInput } from "@/configure/types/validation";

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

  it("hooks set metadata correctly", () => {
    const result = createTable("Test", {
      name: { kind: "string", hooks: { create: () => "default" } },
    });
    expect(result.fields.name.metadata.hooks).toBeDefined();
    expect(result.fields.name.metadata.hooks!.create).toBeDefined();
  });

  it("validate sets metadata correctly", () => {
    const result = createTable("Test", {
      age: {
        kind: "int",
        validate: [({ value }) => value >= 0, "Must be non-negative"],
      },
    });
    expect(result.fields.age.metadata.validate).toBeDefined();
    expect(result.fields.age.metadata.validate!.length).toBe(1);
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

describe("createTable hooks+serial mutual exclusion", () => {
  it("hooks and serial cannot be combined on the same descriptor", () => {
    createTable("Test", {
      // @ts-expect-error hooks and serial are mutually exclusive
      code: { kind: "string", hooks: { create: () => "default" }, serial: { start: 1 } },
    });
  });

  it("hooks descriptor sets serial: false in defined", () => {
    const result = createTable("Test", {
      name: { kind: "string", hooks: { create: () => "default" } },
    });
    type NameDefined = (typeof result.fields.name)["_defined"];
    expectTypeOf<NameDefined["serial"]>().toEqualTypeOf<false>();
  });

  it("serial descriptor sets hooks: { create: false; update: false } in defined", () => {
    const result = createTable("Test", {
      code: { kind: "string", serial: { start: 1 } },
    });
    type CodeDefined = (typeof result.fields.code)["_defined"];
    expectTypeOf<CodeDefined["hooks"]>().toEqualTypeOf<{ create: false; update: false }>();
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

describe("createTable hook type validation", () => {
  it("hook returning correct type is accepted", () => {
    const result = createTable("Test", {
      name: { kind: "string", hooks: { create: () => "default" } },
    });
    expect(result.fields.name.metadata.hooks).toBeDefined();
  });

  it("hook returning wrong type causes type error", () => {
    createTable("Test", {
      // @ts-expect-error hook returns number but field expects string
      name: { kind: "string", hooks: { create: () => 42 } },
    });
  });

  it("datetime hook returning Date is accepted", () => {
    const result = createTable("Test", {
      createdAt: { kind: "datetime", hooks: { create: () => new Date() } },
    });
    expect(result.fields.createdAt.metadata.hooks).toBeDefined();
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

describe("createTable descriptor-level hooks value typing", () => {
  it("string hooks value is typed as string | null", () => {
    const hooks: Hook<unknown, string> = {
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<string | null>();
        return value ?? "default";
      },
    };
    createTable("Test", { name: { kind: "string", hooks } });
  });

  it("int hooks value is typed as number | null", () => {
    const hooks: Hook<unknown, number> = {
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<number | null>();
        return value ?? 0;
      },
    };
    createTable("Test", { count: { kind: "int", hooks } });
  });

  it("datetime hooks value is typed as string | Date | null", () => {
    const hooks: Hook<unknown, string | Date> = {
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<string | Date | null>();
        return value ?? new Date();
      },
    };
    createTable("Test", { ts: { kind: "datetime", hooks } });
  });

  it("enum hooks value is typed as enum union | null", () => {
    createTable(
      "Test",
      { role: { kind: "enum", values: ["ADMIN", "USER"] } },
      {
        hooks: {
          role: {
            create: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<"ADMIN" | "USER" | null>();
              return value ?? "USER";
            },
          },
        },
      },
    );
  });

  it("array string hooks value is typed as string[] | null", () => {
    const hooks: Hook<unknown, string[]> = {
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<string[] | null>();
        return value ?? [];
      },
    };
    const result = createTable("Test", { tags: { kind: "string", array: true, hooks } });
    expect(result.fields.tags.type).toBe("string");
  });

  it("array int hooks value is typed as number[] | null", () => {
    const hooks: Hook<unknown, number[]> = {
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<number[] | null>();
        return value ?? [];
      },
    };
    createTable("Test", { counts: { kind: "int", array: true, hooks } });
  });
});

describe("createTable descriptor-level validate value typing", () => {
  it("string validate value is typed as string", () => {
    const validate: FieldValidateInput<string> = ({ value }) => {
      expectTypeOf(value).toEqualTypeOf<string>();
      return value.length > 0;
    };
    createTable("Test", { name: { kind: "string", validate } });
  });

  it("int validate value is typed as number", () => {
    const validate: FieldValidateInput<number> = ({ value }) => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return value >= 0;
    };
    createTable("Test", { count: { kind: "int", validate } });
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
    expect(result.fields.createdAt.metadata.hooks).toBeDefined();
    expect(result.fields.updatedAt.metadata.hooks).toBeDefined();
  });
});

describe("createTable type-level hooks/validate exclusion in options", () => {
  it("field with descriptor-level hooks is excluded from type-level hooks in options", () => {
    createTable(
      "Test",
      {
        name: { kind: "string", hooks: { create: () => "default" } },
        email: { kind: "string" },
      },
      {
        hooks: {
          // @ts-expect-error name already has hooks at descriptor level
          name: { create: () => "override" },
        },
      },
    );
  });

  it("field with descriptor-level validate is excluded from type-level validate in options", () => {
    createTable(
      "Test",
      {
        name: { kind: "string", validate: () => true },
        email: { kind: "string" },
      },
      {
        validate: {
          // @ts-expect-error name already has validate at descriptor level
          name: () => true,
        },
      },
    );
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

describe("createTable inline hook type auto-resolution", () => {
  it("inline scalar string hook value is typed as string | null", () => {
    createTable("Test", {
      name: {
        kind: "string",
        hooks: {
          create: ({ value }) => {
            expectTypeOf(value).toEqualTypeOf<string | null>();
            return value ?? "default";
          },
        },
      },
    });
  });

  it("inline array string hook value is typed as string[] | null", () => {
    createTable("Test", {
      tags: {
        kind: "string",
        array: true,
        hooks: {
          create: ({ value }) => {
            expectTypeOf(value).toEqualTypeOf<string[] | null>();
            return value ?? [];
          },
        },
      },
    });
  });

  it("inline array int hook value is typed as number[] | null", () => {
    createTable("Test", {
      counts: {
        kind: "int",
        array: true,
        hooks: {
          create: ({ value }) => {
            expectTypeOf(value).toEqualTypeOf<number[] | null>();
            return value ?? [];
          },
        },
      },
    });
  });

  it("type-level hook on scalar string resolves value as string | null", () => {
    createTable(
      "Test",
      { name: { kind: "string" } },
      {
        hooks: {
          name: {
            create: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<string | null>();
              return value ?? "default";
            },
          },
        },
        permission: unsafeAllowAllTypePermission,
      },
    );
  });

  it("type-level hook on array string resolves value as string[] | null", () => {
    createTable(
      "Test",
      { tags: { kind: "string", array: true } },
      {
        hooks: {
          tags: {
            create: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<string[] | null>();
              return value ?? [];
            },
          },
        },
        permission: unsafeAllowAllTypePermission,
      },
    );
  });

  // Known TS limitation: inline enum hooks (descriptor-level) cannot narrow
  // `value` to the literal union. The generic V in EnumDescriptor<V> is not in
  // a direct inference position when contextual-typing callbacks inside a mapped
  // object parameter (TS reverse-inference limitation). The widened V causes a
  // hook return-type mismatch (string vs literal union), making the descriptor
  // collapse to `never`.
  //
  // Workarounds that correctly resolve enum literal types:
  //   1. Type-level hooks: options.hooks.<field>  (tested below)
  //   2. Fluent API: db.enum(...).hooks(...)       (tested below)

  it("fluent enum hook value is typed as literal union | null", () => {
    const role = db.enum(["ADMIN", "USER"]).hooks({
      create: ({ value }) => {
        expectTypeOf(value).toEqualTypeOf<"ADMIN" | "USER" | null>();
        return value ?? "USER";
      },
    });
    const result = createTable("Test", { role });
    expect(result.fields.role.type).toBe("enum");
  });

  it("type-level hook on enum resolves value as literal union | null", () => {
    createTable(
      "Test",
      { role: { kind: "enum", values: ["ADMIN", "USER"] } },
      {
        hooks: {
          role: {
            create: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<"ADMIN" | "USER" | null>();
              return value ?? "USER";
            },
          },
        },
        permission: unsafeAllowAllTypePermission,
      },
    );
  });
});
