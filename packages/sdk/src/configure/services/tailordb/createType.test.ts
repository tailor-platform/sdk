import { describe, it, expectTypeOf, expect } from "vitest";
import { unauthenticatedTailorUser } from "@/configure/types";
import { createType, timestampFields } from "./createType";
import { db } from "./schema";
import type { output } from "@/configure/types/helpers";

describe("createType basic field type tests", () => {
  it("string field outputs string type correctly", () => {
    const result = createType("Test", {
      name: { kind: "string" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it("int field outputs number type correctly", () => {
    const result = createType("Test", {
      age: { kind: "int" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      age: number;
    }>();
  });

  it("bool field outputs boolean type correctly", () => {
    const result = createType("Test", {
      active: { kind: "bool" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      active: boolean;
    }>();
  });

  it("float field outputs number type correctly", () => {
    const result = createType("Test", {
      price: { kind: "float" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      price: number;
    }>();
  });

  it("uuid field outputs string type correctly", () => {
    const result = createType("Test", {
      ref: { kind: "uuid" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      ref: string;
    }>();
  });

  it("date field outputs string type correctly", () => {
    const result = createType("Test", {
      birthDate: { kind: "date" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      birthDate: string;
    }>();
  });

  it("datetime field outputs string | Date type correctly", () => {
    const result = createType("Test", {
      timestamp: { kind: "datetime" },
    });
    expectTypeOf<output<typeof result>>().toMatchObjectType<{
      id: string;
      timestamp: string | Date;
    }>();
  });

  it("time field outputs string type correctly", () => {
    const result = createType("Test", {
      openingTime: { kind: "time" },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      openingTime: string;
    }>();
  });
});

describe("createType optional and array tests", () => {
  it("optional generates nullable type", () => {
    const result = createType("Test", {
      description: { kind: "string", optional: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      description?: string | null;
    }>();
  });

  it("array generates array type", () => {
    const result = createType("Test", {
      tags: { kind: "string", array: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      tags: string[];
    }>();
  });

  it("optional array works correctly", () => {
    const result = createType("Test", {
      items: { kind: "string", optional: true, array: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      items?: string[] | null;
    }>();
  });
});

describe("createType enum tests", () => {
  it("enum literal types are inferred", () => {
    const result = createType("Test", {
      role: { kind: "enum", values: ["MANAGER", "STAFF"] },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      role: "MANAGER" | "STAFF";
    }>();
  });

  it("optional enum works correctly", () => {
    const result = createType("Test", {
      priority: { kind: "enum", values: ["high", "medium", "low"], optional: true },
    });
    expectTypeOf<output<typeof result>>().toEqualTypeOf<{
      id: string;
      priority?: "high" | "medium" | "low" | null;
    }>();
  });

  it("enum metadata has correct allowedValues", () => {
    const result = createType("Test", {
      status: { kind: "enum", values: ["active", "inactive"] },
    });
    expect(result.fields.status.metadata.allowedValues).toEqual([
      { value: "active", description: "" },
      { value: "inactive", description: "" },
    ]);
  });
});

describe("createType runtime metadata tests", () => {
  it("unique sets metadata correctly", () => {
    const result = createType("Test", {
      email: { kind: "string", unique: true },
    });
    expect(result.fields.email.metadata.unique).toBe(true);
    expect(result.fields.email.metadata.index).toBe(true);
  });

  it("index sets metadata correctly", () => {
    const result = createType("Test", {
      name: { kind: "string", index: true },
    });
    expect(result.fields.name.metadata.index).toBe(true);
    expect(result.fields.name.metadata.unique).toBeUndefined();
  });

  it("vector sets metadata correctly", () => {
    const result = createType("Test", {
      embedding: { kind: "string", vector: true },
    });
    expect(result.fields.embedding.metadata.vector).toBe(true);
  });

  it("hooks set metadata correctly", () => {
    const result = createType("Test", {
      name: { kind: "string", hooks: { create: () => "default" } },
    });
    expect(result.fields.name.metadata.hooks).toBeDefined();
    expect(result.fields.name.metadata.hooks!.create).toBeDefined();
  });

  it("validate sets metadata correctly", () => {
    const result = createType("Test", {
      age: {
        kind: "int",
        validate: [({ value }) => (value as number) >= 0, "Must be non-negative"],
      },
    });
    expect(result.fields.age.metadata.validate).toBeDefined();
    expect(result.fields.age.metadata.validate!.length).toBe(1);
  });

  it("serial sets metadata correctly", () => {
    const result = createType("Test", {
      code: { kind: "string", serial: { start: 1, format: "INV-%05d" } },
    });
    expect(result.fields.code.metadata.serial).toEqual({
      start: 1,
      format: "INV-%05d",
    });
  });

  it("description sets metadata correctly", () => {
    const result = createType("Test", {
      name: { kind: "string", description: "The user's name" },
    });
    expect(result.fields.name.metadata.description).toBe("The user's name");
  });
});

describe("createType relation tests", () => {
  const User = db.type("User", {
    name: db.string(),
  });

  it("rawRelation returns correct config", () => {
    const result = createType("Test", {
      userId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: User },
        },
      },
    });
    expect(result.fields.userId.rawRelation).toEqual({
      type: "n-1",
      toward: { type: "User", as: undefined, key: undefined },
      backward: undefined,
    });
  });

  it("relation with all options", () => {
    const result = createType("Test", {
      managerId: {
        kind: "uuid",
        relation: {
          type: "oneToOne",
          toward: { type: User, as: "manager", key: "id" },
          backward: "subordinates",
        },
      },
    });
    expect(result.fields.managerId.rawRelation).toEqual({
      type: "oneToOne",
      toward: { type: "User", as: "manager", key: "id" },
      backward: "subordinates",
    });
    expect(result.fields.managerId.metadata.unique).toBe(true);
    expect(result.fields.managerId.metadata.index).toBe(true);
  });

  it("self-referencing relation", () => {
    const result = createType("Test", {
      parentId: {
        kind: "uuid",
        optional: true,
        relation: {
          type: "n-1",
          toward: { type: "self" },
          backward: "children",
        },
      },
    });
    expect(result.fields.parentId.rawRelation).toEqual({
      type: "n-1",
      toward: { type: "self", as: undefined, key: undefined },
      backward: "children",
    });
  });
});

describe("createType nested object tests", () => {
  it("nested object fields are built recursively", () => {
    const result = createType("Test", {
      address: {
        kind: "object",
        fields: {
          street: { kind: "string" },
          city: { kind: "string" },
          zip: { kind: "string", optional: true },
        },
      },
    });
    expect(result.fields.address.type).toBe("nested");
    expect(Object.keys(result.fields.address.fields)).toEqual(["street", "city", "zip"]);
    expect(result.fields.address.fields.street.type).toBe("string");
  });
});

describe("createType type-level options tests", () => {
  it("permission is set on metadata", () => {
    const result = createType(
      "Test",
      { name: { kind: "string" } },
      {
        permission: {
          create: [[[{ user: "_loggedIn" as const }, "=", true]]],
          read: [[[{ user: "_loggedIn" as const }, "=", true]]],
          update: [[[{ user: "_loggedIn" as const }, "=", true]]],
          delete: [[[{ user: "_loggedIn" as const }, "=", true]]],
        },
      },
    );
    expect(result.metadata.permissions.record).toBeDefined();
  });

  it("gqlPermission is set on metadata", () => {
    const result = createType(
      "Test",
      { name: { kind: "string" } },
      {
        gqlPermission: [
          {
            conditions: [[{ user: "_loggedIn" as const }, "=", true]],
            actions: "all",
            permit: true,
          },
        ],
      },
    );
    expect(result.metadata.permissions.gql).toBeDefined();
  });

  it("features are set on metadata", () => {
    const result = createType(
      "Test",
      { name: { kind: "string" } },
      { features: { aggregation: true } },
    );
    expect(result.metadata.settings?.aggregation).toBe(true);
  });

  it("description is set on metadata", () => {
    const result = createType("Test", { name: { kind: "string" } }, { description: "A test type" });
    expect(result.metadata.description).toBe("A test type");
  });

  it("pluralForm is set on metadata", () => {
    const result = createType("Test", { name: { kind: "string" } }, { pluralForm: "Tests" });
    expect(result.metadata.settings?.pluralForm).toBe("Tests");
  });

  it("pluralForm via tuple name", () => {
    const result = createType(["Person", "People"], { name: { kind: "string" } });
    expect(result.metadata.name).toBe("Person");
    expect(result.metadata.settings?.pluralForm).toBe("People");
  });
});

describe("createType passthrough tests", () => {
  it("db.fields.timestamps() can be spread into descriptors", () => {
    const result = createType("Test", {
      name: { kind: "string" },
      ...db.fields.timestamps(),
    });
    expect(result.fields.createdAt).toBeDefined();
    expect(result.fields.updatedAt).toBeDefined();
    expect(result.fields.createdAt.metadata.hooks).toBeDefined();
    expect(result.fields.updatedAt.metadata.hooks).toBeDefined();
  });

  it("fluent API fields can be mixed in", () => {
    const result = createType("Test", {
      name: { kind: "string" },
      email: db.string().unique(),
    });
    expect(result.fields.email.metadata.unique).toBe(true);
    expect(result.fields.email.metadata.index).toBe(true);
  });
});

describe("createType round-trip metadata compatibility", () => {
  it("createType metadata matches db.type() metadata for basic fields", () => {
    const objectLiteral = createType("User", {
      name: { kind: "string" },
      email: { kind: "string", unique: true },
      age: { kind: "int", optional: true },
    });

    const fluent = db.type("User", {
      name: db.string(),
      email: db.string().unique(),
      age: db.int({ optional: true }),
    });

    // Compare field-level metadata
    expect(objectLiteral.fields.name.metadata.required).toBe(fluent.fields.name.metadata.required);
    expect(objectLiteral.fields.email.metadata.unique).toBe(fluent.fields.email.metadata.unique);
    expect(objectLiteral.fields.email.metadata.index).toBe(fluent.fields.email.metadata.index);
    expect(objectLiteral.fields.age.metadata.required).toBe(fluent.fields.age.metadata.required);

    // Compare type-level metadata
    expect(objectLiteral.metadata.name).toBe(fluent.metadata.name);
  });

  it("createType enum metadata matches db.type() enum metadata", () => {
    const objectLiteral = createType("Test", {
      status: { kind: "enum", values: ["active", "inactive"] },
    });

    const fluent = db.type("Test", {
      status: db.enum(["active", "inactive"]),
    });

    expect(objectLiteral.fields.status.metadata.allowedValues).toEqual(
      fluent.fields.status.metadata.allowedValues,
    );
  });
});

describe("timestampFields", () => {
  it("returns createdAt and updatedAt descriptors", () => {
    const ts = timestampFields();
    expect(ts.createdAt.kind).toBe("datetime");
    expect(ts.createdAt.hooks.create).toBeDefined();
    expect(ts.createdAt.description).toBe("Record creation timestamp");

    expect(ts.updatedAt.kind).toBe("datetime");
    expect(ts.updatedAt.optional).toBe(true);
    expect(ts.updatedAt.hooks.update).toBeDefined();
    expect(ts.updatedAt.description).toBe("Record last update timestamp");
  });
});

describe("createType parse tests", () => {
  function parseCtx(value: unknown) {
    return { value, data: {}, user: unauthenticatedTailorUser };
  }

  const allFieldsType = createType("Test", {
    name: { kind: "string" },
    count: { kind: "int" },
    price: { kind: "float" },
    active: { kind: "bool" },
    ref: { kind: "uuid" },
    birthDate: { kind: "date" },
    timestamp: { kind: "datetime" },
    openTime: { kind: "time" },
    role: { kind: "enum", values: ["ADMIN", "USER"] },
    address: {
      kind: "object",
      fields: {
        street: { kind: "string" },
        city: { kind: "string" },
      },
    },
  });

  it("validates required fields", () => {
    const parseResult = allFieldsType.fields.name.parse(parseCtx(undefined));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toBe("Required field is missing");
  });

  it("string: valid value", () => {
    const parseResult = allFieldsType.fields.name.parse(parseCtx("hello"));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("hello");
  });

  it("int: valid value", () => {
    const parseResult = allFieldsType.fields.count.parse(parseCtx(42));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: number }).value).toBe(42);
  });

  it("int: invalid value", () => {
    const parseResult = allFieldsType.fields.count.parse(parseCtx("hello"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected an integer");
  });

  it("float: valid value", () => {
    const parseResult = allFieldsType.fields.price.parse(parseCtx(3.14));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: number }).value).toBe(3.14);
  });

  it("float: invalid value", () => {
    const parseResult = allFieldsType.fields.price.parse(parseCtx("hello"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected a number");
  });

  it("bool: valid value", () => {
    const parseResult = allFieldsType.fields.active.parse(parseCtx(true));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: boolean }).value).toBe(true);
  });

  it("bool: invalid value", () => {
    const parseResult = allFieldsType.fields.active.parse(parseCtx("hello"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected a boolean");
  });

  it("uuid: valid value", () => {
    const parseResult = allFieldsType.fields.ref.parse(
      parseCtx("550e8400-e29b-41d4-a716-446655440000"),
    );
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("uuid: invalid value", () => {
    const parseResult = allFieldsType.fields.ref.parse(parseCtx("not-a-uuid"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected a valid UUID");
  });

  it("date: valid value", () => {
    const parseResult = allFieldsType.fields.birthDate.parse(parseCtx("2024-01-15"));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("2024-01-15");
  });

  it("date: invalid value", () => {
    const parseResult = allFieldsType.fields.birthDate.parse(parseCtx("not-a-date"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected to match");
  });

  it("datetime: Date object fails string-based validation", () => {
    const dateObj = new Date("2024-01-15T10:30:00.000Z");
    const parseResult = allFieldsType.fields.timestamp.parse(parseCtx(dateObj));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected to match ISO format");
  });

  it("datetime: valid ISO string", () => {
    const parseResult = allFieldsType.fields.timestamp.parse(parseCtx("2024-01-15T10:30:00Z"));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("2024-01-15T10:30:00Z");
  });

  it("datetime: invalid value", () => {
    const parseResult = allFieldsType.fields.timestamp.parse(parseCtx("not-a-datetime"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected to match ISO format");
  });

  it("time: valid value", () => {
    const parseResult = allFieldsType.fields.openTime.parse(parseCtx("10:30"));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("10:30");
  });

  it("time: invalid value", () => {
    const parseResult = allFieldsType.fields.openTime.parse(parseCtx("not-a-time"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Expected to match");
  });

  it("enum: valid value from allowed values", () => {
    const parseResult = allFieldsType.fields.role.parse(parseCtx("ADMIN"));
    expect(parseResult.issues).toBeUndefined();
    expect((parseResult as { value: string }).value).toBe("ADMIN");
  });

  it("enum: invalid value not in allowed values", () => {
    const parseResult = allFieldsType.fields.role.parse(parseCtx("SUPERADMIN"));
    expect(parseResult.issues).toBeDefined();
    expect(parseResult.issues![0].message).toContain("Must be one of");
  });

  it("object: valid nested object with correct fields", () => {
    const parseResult = allFieldsType.fields.address.parse(
      parseCtx({ street: "123 Main St", city: "Springfield" }),
    );
    expect(parseResult.issues).toBeUndefined();
  });
});

describe("createType clone preservation", () => {
  it("clone preserves hooks, validate, serial, and unique metadata", () => {
    const result = createType("Test", {
      code: {
        kind: "string",
        hooks: { create: () => "default" },
        validate: [({ value }) => (value as string).length > 0, "Must not be empty"],
        serial: { start: 1, format: "CODE-%05d" },
        unique: true,
      },
    });

    const cloned = result.fields.code.clone();

    expect(cloned.metadata.hooks).toBeDefined();
    expect(cloned.metadata.hooks!.create).toBeDefined();
    expect(cloned.metadata.validate).toBeDefined();
    expect(cloned.metadata.validate!.length).toBe(1);
    expect(cloned.metadata.serial).toEqual({ start: 1, format: "CODE-%05d" });
    expect(cloned.metadata.unique).toBe(true);
    expect(cloned.metadata.index).toBe(true);
  });
});

describe("createType as relation target", () => {
  it("createType result can be used as a relation target", () => {
    const TypeA = createType("TypeA", {
      name: { kind: "string" },
    });

    const TypeB = createType("TypeB", {
      typeAId: {
        kind: "uuid",
        relation: {
          type: "n-1",
          toward: { type: TypeA },
        },
      },
    });

    expect(TypeB.fields.typeAId.rawRelation).toBeDefined();
    expect(TypeB.fields.typeAId.rawRelation!.toward.type).toBe("TypeA");
  });
});

describe("createType type-level operations", () => {
  it("pickFields returns only picked fields plus id", () => {
    const result = createType("Test", {
      name: { kind: "string" },
      email: { kind: "string" },
      age: { kind: "int" },
    });

    const picked = result.pickFields(["name"], {});
    expect(Object.keys(picked)).toEqual(["name"]);
    expect(picked.name).toBeDefined();
    expect(picked.name.type).toBe("string");
  });

  it("omitFields removes specified fields", () => {
    const result = createType("Test", {
      name: { kind: "string" },
      email: { kind: "string" },
      age: { kind: "int" },
    });

    const omitted = result.omitFields(["name"]);
    expect(Object.keys(omitted)).not.toContain("name");
    expect(omitted.id).toBeDefined();
    expect(omitted.email).toBeDefined();
    expect(omitted.age).toBeDefined();
  });

  it("hooks sets type-level hooks metadata", () => {
    const result = createType("Test", {
      name: { kind: "string" },
    });

    result.hooks({
      name: { create: ({ data }) => String(data) },
    });

    expect(result.fields.name.metadata.hooks).toBeDefined();
  });

  it("validate sets type-level validate metadata", () => {
    const result = createType("Test", {
      name: { kind: "string" },
    });

    result.validate({
      name: [({ value }) => value.length > 0, "Must not be empty"],
    });

    expect(result.fields.name.metadata.validate).toBeDefined();
  });
});

describe("createType indexes option", () => {
  it("indexes are set on metadata", () => {
    const result = createType(
      "Test",
      {
        firstName: { kind: "string" },
        lastName: { kind: "string" },
      },
      {
        indexes: [{ fields: ["firstName", "lastName"], unique: true }],
      },
    );

    expect(result.metadata.indexes).toBeDefined();
    const indexKeys = Object.keys(result.metadata.indexes!);
    expect(indexKeys.length).toBe(1);
    const indexEntry = result.metadata.indexes![indexKeys[0]];
    expect(indexEntry.fields).toEqual(["firstName", "lastName"]);
    expect(indexEntry.unique).toBe(true);
  });
});

describe("createType typeName option", () => {
  it("typeName sets metadata on enum fields", () => {
    const result = createType("Test", {
      status: { kind: "enum", values: ["active", "inactive"], typeName: "StatusEnum" },
    });
    expect(result.fields.status.metadata.typeName).toBe("StatusEnum");
  });

  it("typeName sets metadata on object fields", () => {
    const result = createType("Test", {
      address: {
        kind: "object",
        typeName: "AddressInput",
        fields: {
          street: { kind: "string" },
          city: { kind: "string" },
        },
      },
    });
    expect(result.fields.address.metadata.typeName).toBe("AddressInput");
  });
});

describe("createType files option", () => {
  it("files are set on metadata", () => {
    const result = createType(
      "Test",
      { name: { kind: "string" } },
      { files: { avatar: "image/png" } },
    );
    expect(result.metadata.files).toBeDefined();
    expect(result.metadata.files!.avatar).toBe("image/png");
  });
});

describe("createType keyOnly relation", () => {
  it("keyOnly relation sets rawRelation and index", () => {
    const Target = createType("Target", { name: { kind: "string" } });
    const result = createType("Test", {
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

describe("createType type-safe options", () => {
  it("permission accepts record operands typed to the type's fields", () => {
    const result = createType(
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
    const result = createType(
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
    const result = createType(
      "Employee",
      { name: { kind: "string" } },
      { files: { avatar: "image/png" } },
    );
    expect(result.metadata.files).toBeDefined();
  });
});

describe("createType array field guards", () => {
  it("array fields do not get index or unique metadata", () => {
    // Runtime guard: buildField skips index/unique for array fields
    const result = createType("Test", {
      tags: { kind: "string", array: true },
    });
    expect(result.fields.tags.metadata.index).toBeUndefined();
    expect(result.fields.tags.metadata.unique).toBeUndefined();
  });
});
