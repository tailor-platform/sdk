import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { toSchemaOutputs } from "@/utils/test/internal";
import { parseTypes } from "./type-parser";

describe("parseTypes", () => {
  describe("array field validation", () => {
    it("should throw error when index is set on array field", () => {
      // Bypass type check by directly setting metadata
      const field = db.string({ array: true });
      (field as unknown as { _metadata: { index: boolean } })._metadata.index = true;

      const testType = db.type("Test", {
        tags: field,
      });

      expect(() => parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace")).toThrow(
        'Field "tags" on type "Test": index cannot be set on array fields',
      );
    });

    it("should throw error when unique is set on array field", () => {
      // Bypass type check by directly setting metadata
      const field = db.string({ array: true });
      (field as unknown as { _metadata: { unique: boolean } })._metadata.unique = true;

      const testType = db.type("Test", {
        tags: field,
      });

      expect(() => parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace")).toThrow(
        'Field "tags" on type "Test": unique cannot be set on array fields',
      );
    });

    it("should allow index on non-array fields", () => {
      const testType = db.type("Test", {
        email: db.string().index(),
      });

      const result = parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace");
      expect(result.Test.fields.email.config.index).toBe(true);
    });

    it("should allow unique on non-array fields", () => {
      const testType = db.type("Test", {
        email: db.string().unique(),
      });

      const result = parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace");
      expect(result.Test.fields.email.config.unique).toBe(true);
    });
  });

  describe("buildBackwardRelationships", () => {
    it("should build backward relationships correctly", () => {
      const employee = db.type("Employee", {
        name: db.string(),
      });

      const performanceReview = db.type("PerformanceReview", {
        employeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee },
          backward: "performanceReviews",
        }),
      });

      const result = parseTypes(
        toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
        "test-namespace",
      );

      expect(result.Employee.backwardRelationships).toHaveProperty("performanceReviews");
      expect(result.Employee.backwardRelationships.performanceReviews).toMatchObject({
        name: "performanceReviews",
        targetType: "PerformanceReview",
        targetField: "employeeId",
        sourceField: "id",
        isArray: true,
      });
    });

    it("should throw error when backward relation names are duplicated", () => {
      const employee = db.type("Employee", {
        name: db.string(),
      });

      // Two fields referencing the same type without explicit backward names
      // Both will generate "performanceReviews" as the backward name
      const performanceReview = db.type("PerformanceReview", {
        targetEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "targetEmployee" },
        }),
        authorEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "authorEmployee" },
        }),
      });

      expect(() =>
        parseTypes(
          toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
          "test-namespace",
        ),
      ).toThrow(/Backward relation name conflicts detected/);
      expect(() =>
        parseTypes(
          toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
          "test-namespace",
        ),
      ).toThrow(/performanceReviews/);
      expect(() =>
        parseTypes(
          toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
          "test-namespace",
        ),
      ).toThrow(/Employee/);
    });

    it("should not throw error when backward names are explicitly set to be unique", () => {
      const employee = db.type("Employee", {
        name: db.string(),
      });

      // Two fields referencing the same type with explicit unique backward names
      const performanceReview = db.type("PerformanceReview", {
        targetEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "targetEmployee" },
          backward: "targetReviews",
        }),
        authorEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "authorEmployee" },
          backward: "authorReviews",
        }),
      });

      const result = parseTypes(
        toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
        "test-namespace",
      );

      expect(result.Employee.backwardRelationships).toHaveProperty("targetReviews");
      expect(result.Employee.backwardRelationships).toHaveProperty("authorReviews");
      expect(result.Employee.backwardRelationships.targetReviews).toMatchObject({
        name: "targetReviews",
        targetType: "PerformanceReview",
        targetField: "targetEmployeeId",
      });
      expect(result.Employee.backwardRelationships.authorReviews).toMatchObject({
        name: "authorReviews",
        targetType: "PerformanceReview",
        targetField: "authorEmployeeId",
      });
    });

    it("should include source file information in error message when available", () => {
      const employee = db.type("Employee", {
        name: db.string(),
      });

      const performanceReview = db.type("PerformanceReview", {
        targetEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "targetEmployee" },
        }),
        authorEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "authorEmployee" },
        }),
      });

      const typeSourceInfo = {
        PerformanceReview: {
          filePath: "/path/to/performanceReview.ts",
          exportName: "performanceReview",
        },
      };

      expect(() =>
        parseTypes(
          toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
          "test-namespace",
          typeSourceInfo,
        ),
      ).toThrow(/\/path\/to\/performanceReview\.ts/);
    });

    it("should generate default backward names using inflection", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      // No explicit backward name, should generate "posts" (plural of "Post")
      const post = db.type("Post", {
        userId: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      expect(result.User.backwardRelationships).toHaveProperty("posts");
      expect(result.User.backwardRelationships.posts).toMatchObject({
        name: "posts",
        targetType: "Post",
        isArray: true,
      });
    });

    it("should generate singular backward name for unique relations", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      // Unique relation (1-1), should generate singular "profile"
      const profile = db.type("Profile", {
        userId: db.uuid().relation({
          type: "1-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.User.backwardRelationships).toHaveProperty("profile");
      expect(result.User.backwardRelationships.profile).toMatchObject({
        name: "profile",
        targetType: "Profile",
        isArray: false,
      });
    });

    it("should throw error when backward name conflicts with existing field", () => {
      // User has a field named "posts"
      const user = db.type("User", {
        name: db.string(),
        posts: db.string({ array: true }), // existing field
      });

      // Post's backward relation will generate "posts" which conflicts
      const post = db.type("Post", {
        userId: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/posts/);
    });

    it("should throw error when backward name conflicts with files field", () => {
      const user = db
        .type("User", {
          name: db.string(),
        })
        .files({
          posts: "user posts file", // files field named "posts"
        });

      // Post's backward relation will generate "posts" which conflicts
      const post = db.type("Post", {
        userId: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/posts/);
    });
  });

  describe("validateRelationType", () => {
    it("should throw error when relation type is missing", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      // Missing 'type' property - only TypeScript error, need runtime check
      const post = db.type("Post", {
        // @ts-ignore - intentionally missing 'type' to test runtime validation (tsgo/tsc compat)
        userId: db.uuid().relation({
          // @ts-ignore - ignore No overload matches this call error
          toward: { type: user },
        }),
      });

      // Now validated at schema level by Zod - error is thrown in toSchemaOutput
      expect(() => toSchemaOutputs({ User: user, Post: post })).toThrow(/Invalid option/);
      expect(() => toSchemaOutputs({ User: user, Post: post })).toThrow(/rawRelation/);
    });

    it("should throw error when relation type is invalid", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const post = db.type("Post", {
        userId: db.uuid().relation({
          // @ts-ignore - intentionally invalid 'type' to test runtime validation (tsgo/tsc compat)
          type: "invalid-type",
          // @ts-ignore - ignore No overload matches this call error
          toward: { type: user },
        }),
      });

      // Now validated at schema level by Zod - error is thrown in toSchemaOutput
      expect(() => toSchemaOutputs({ User: user, Post: post })).toThrow(/Invalid option/);
    });

    it("should throw error when target type does not exist", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const post = db.type("Post", {
        userId: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      // Only include Post, not User - should throw error about unknown type
      expect(() => parseTypes(toSchemaOutputs({ Post: post }), "test-namespace")).toThrow(
        /references unknown type "User"/,
      );
    });

    it("should accept valid relation types", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const validTypes = ["oneToOne", "1-1", "manyToOne", "n-1", "N-1", "keyOnly"] as const;

      for (const relationType of validTypes) {
        const post = db.type("Post", {
          userId: db.uuid().relation({
            type: relationType,
            toward: { type: user },
          }),
        });

        expect(() =>
          parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
        ).not.toThrow(/relation type/);
      }
    });
  });

  describe("processRelation", () => {
    it("should compute derived metadata for relations", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const post = db.type("Post", {
        authorId: db.uuid().relation({
          type: "n-1",
          toward: { type: user, as: "author" },
          backward: "posts",
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      // Check computed metadata on field config
      const authorIdConfig = result.Post.fields.authorId.config;
      expect(authorIdConfig.foreignKey).toBe(true);
      expect(authorIdConfig.foreignKeyType).toBe("User");
      expect(authorIdConfig.foreignKeyField).toBe("id");
      expect(authorIdConfig.unique).toBe(false);
      expect(authorIdConfig.index).toBe(true);
    });

    it("should set unique=true for oneToOne relations (relation only)", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const profile = db.type("Profile", {
        userId: db.uuid().relation({
          type: "1-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.Profile.fields.userId.config.unique).toBe(true);
    });

    it("should set unique=true for oneToOne relations (unique before relation)", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const profile = db.type("Profile", {
        userId: db
          .uuid()
          .unique()
          .relation({
            type: "1-1",
            toward: { type: user },
          }),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.Profile.fields.userId.config.unique).toBe(true);
    });

    it("should set unique=true for oneToOne relations (unique after relation)", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const profile = db.type("Profile", {
        // @ts-expect-error - Testing runtime behavior: 1-1 already implies unique, but we test the call order
        userId: db
          .uuid()
          .relation({
            type: "1-1",
            toward: { type: user },
          })
          .unique(),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.Profile.fields.userId.config.unique).toBe(true);
    });

    it("should throw error when unique is set on n-1 relation (unique before relation)", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const employee = db.type("Employee", {
        userID: db
          .uuid()
          .unique()
          .relation({
            type: "n-1",
            toward: { type: user },
          }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Employee: employee }), "test-namespace"),
      ).toThrow(
        'Field "userID" on type "Employee": cannot set unique on n-1 (manyToOne) relation. ' +
          "Use 1-1 (oneToOne) relation instead, or remove the unique constraint.",
      );
    });

    it("should throw error when unique is set on n-1 relation (unique after relation)", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const employee = db.type("Employee", {
        userID: db
          .uuid()
          .relation({
            type: "n-1",
            toward: { type: user },
          })
          .unique(),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Employee: employee }), "test-namespace"),
      ).toThrow(
        'Field "userID" on type "Employee": cannot set unique on n-1 (manyToOne) relation. ' +
          "Use 1-1 (oneToOne) relation instead, or remove the unique constraint.",
      );
    });

    it("should handle self-referencing relations", () => {
      const node = db.type("Node", {
        name: db.string(),
        parentId: db.uuid().relation({
          type: "n-1",
          toward: { type: "self" },
          backward: "children",
        }),
      });

      const result = parseTypes(toSchemaOutputs({ Node: node }), "test-namespace");

      // Check that self-reference is resolved to type name
      expect(result.Node.fields.parentId.config.foreignKeyType).toBe("Node");
      expect(result.Node.fields.parentId.relation?.targetType).toBe("Node");
    });

    it("should not create forward/backward relationships for keyOnly relations", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const post = db.type("Post", {
        userId: db.uuid().relation({
          type: "keyOnly",
          toward: { type: user },
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      // keyOnly should not create relation info
      expect(result.Post.fields.userId.relation).toBeUndefined();
      expect(result.Post.forwardRelationships).toEqual({});
      expect(result.User.backwardRelationships).toEqual({});
    });
  });

  describe("record-level hooks materialize as field-level hooks per override key", () => {
    it("emits a field-level hook for each overridden key and leaves untouched fields alone", () => {
      const withRecordHooks = db
        .type(["Hooked", "AllHooked"], {
          name: db.string(),
          fullAddress: db.string(),
          ...db.fields.timestamps(),
        })
        .hooks({
          create: ({ data }) => ({ fullAddress: data.name, createdAt: new Date() }),
          update: ({ data }) => ({ fullAddress: data.name, updatedAt: new Date() }),
        });

      const result = parseTypes(toSchemaOutputs({ Hooked: withRecordHooks }), "test-namespace");

      // No type-level hooks slot — the parsed TailorDBType only carries field-level hooks now.
      expect((result.Hooked as unknown as { hooks?: unknown }).hooks).toBeUndefined();

      // Overridden fields carry a field-level script that invokes the record-level
      // hook and indexes out the key.
      const createExpr = result.Hooked.fields.fullAddress.config.hooks?.create?.expr ?? "";
      expect(createExpr).toContain('"fullAddress"');
      expect(createExpr).toContain("({ data: _data, user:");

      const updateExpr = result.Hooked.fields.fullAddress.config.hooks?.update?.expr ?? "";
      expect(updateExpr).toContain('"fullAddress"');

      // Record-level hook overrides the auto-generated timestamp hook for the same key.
      const createdAtExpr = result.Hooked.fields.createdAt.config.hooks?.create?.expr ?? "";
      expect(createdAtExpr).toContain('"createdAt"');
      // updatedAt only appears in the update hook
      expect(result.Hooked.fields.createdAt.config.hooks?.update).toBeUndefined();

      const updatedAtExpr = result.Hooked.fields.updatedAt.config.hooks?.update?.expr ?? "";
      expect(updatedAtExpr).toContain('"updatedAt"');

      // Fields not in the override set keep no hook.
      expect(result.Hooked.fields.name.config.hooks).toBeUndefined();
    });

    it("keeps auto-generated timestamp hooks when the type has no record-level hooks", () => {
      const withoutRecordHooks = db.type(["Plain", "AllPlain"], {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = parseTypes(toSchemaOutputs({ Plain: withoutRecordHooks }), "test-namespace");

      expect((result.Plain as unknown as { hooks?: unknown }).hooks).toBeUndefined();
      expect(result.Plain.fields.createdAt.config.hooks?.create).toEqual({
        expr: "new Date()",
      });
      expect(result.Plain.fields.updatedAt.config.hooks?.update).toEqual({
        expr: "new Date()",
      });
    });

    it("throws when a record-level hook overrides an unknown field", () => {
      const bad = db
        .type(["Bad", "AllBad"], {
          name: db.string(),
        })
        .hooks({
          // @ts-expect-error - intentionally overriding an unknown field to test runtime validation
          create: () => ({ missingField: "x" }),
        });

      expect(() => parseTypes(toSchemaOutputs({ Bad: bad }), "test-namespace")).toThrow(
        /overrides unknown field "missingField"/,
      );
    });

    it("throws when a record-level hook return value is not a static object literal", () => {
      // Branched return: not a single static object literal — the AST extractor must reject this.
      const bad = db
        .type(["Bad", "AllBad"], {
          name: db.string(),
        })
        .hooks({
          create: ({ data }) => (data.name === "x" ? { name: "y" } : { name: "z" }),
        });

      expect(() => parseTypes(toSchemaOutputs({ Bad: bad }), "test-namespace")).toThrow(
        /Record-level hook must return an object literal/,
      );
    });
  });
});
