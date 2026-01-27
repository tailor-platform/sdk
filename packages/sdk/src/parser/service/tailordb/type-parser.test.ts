import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseTypes } from "./type-parser";

describe("parseTypes", () => {
  describe("array field validation", () => {
    it("should throw error when index is set on non-relation array field", () => {
      // Bypass type check by directly setting metadata
      const field = db.string({ array: true });
      (field as unknown as { _metadata: { index: boolean } })._metadata.index = true;

      const testType = db.type("Test", {
        tags: field,
      });

      expect(() => parseTypes({ Test: testType }, "test-namespace")).toThrow(
        'Field "tags" on type "Test": index cannot be set on array fields',
      );
    });

    it("should allow index on array fields with relations (foreignKey requirement)", () => {
      const contract = db.type("Contract", {
        name: db.string(),
      });

      const order = db.type("Order", {
        contractIDs: db.uuid({ array: true }).relation({
          type: "1-1",
          toward: { type: contract, as: "contracts" },
        }),
      });

      const result = parseTypes({ Contract: contract, Order: order }, "test-namespace");

      // Foreign key fields require index=true for federation, even on arrays
      expect(result.Order.fields.contractIDs.config.index).toBe(true);
      expect(result.Order.fields.contractIDs.config.foreignKey).toBe(true);
      expect(result.Order.fields.contractIDs.config.array).toBe(true);
      // unique should not be set on array fields, even for 1-1 relations
      expect(result.Order.fields.contractIDs.config.unique).toBe(false);
    });

    it("should throw error when unique is set on array field", () => {
      // Bypass type check by directly setting metadata
      const field = db.string({ array: true });
      (field as unknown as { _metadata: { unique: boolean } })._metadata.unique = true;

      const testType = db.type("Test", {
        tags: field,
      });

      expect(() => parseTypes({ Test: testType }, "test-namespace")).toThrow(
        'Field "tags" on type "Test": unique cannot be set on array fields',
      );
    });

    it("should allow index on non-array fields", () => {
      const testType = db.type("Test", {
        email: db.string().index(),
      });

      const result = parseTypes({ Test: testType }, "test-namespace");
      expect(result.Test.fields.email.config.index).toBe(true);
    });

    it("should allow unique on non-array fields", () => {
      const testType = db.type("Test", {
        email: db.string().unique(),
      });

      const result = parseTypes({ Test: testType }, "test-namespace");
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
        { Employee: employee, PerformanceReview: performanceReview },
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
        parseTypes({ Employee: employee, PerformanceReview: performanceReview }, "test-namespace"),
      ).toThrow(/Backward relation name conflicts detected/);
      expect(() =>
        parseTypes({ Employee: employee, PerformanceReview: performanceReview }, "test-namespace"),
      ).toThrow(/performanceReviews/);
      expect(() =>
        parseTypes({ Employee: employee, PerformanceReview: performanceReview }, "test-namespace"),
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
        { Employee: employee, PerformanceReview: performanceReview },
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
          { Employee: employee, PerformanceReview: performanceReview },
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

      const result = parseTypes({ User: user, Post: post }, "test-namespace");

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

      const result = parseTypes({ User: user, Profile: profile }, "test-namespace");

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

      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(/posts/);
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

      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(/posts/);
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

      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(
        /has a relation but is missing the required 'type' property/,
      );
      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(/userId/);
      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(/Post/);
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

      expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).toThrow(
        /has invalid relation type 'invalid-type'/,
      );
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
      expect(() => parseTypes({ Post: post }, "test-namespace")).toThrow(
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

        expect(() => parseTypes({ User: user, Post: post }, "test-namespace")).not.toThrow(
          /relation type/,
        );
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

      const result = parseTypes({ User: user, Post: post }, "test-namespace");

      // Check computed metadata on field config
      const authorIdConfig = result.Post.fields.authorId.config;
      expect(authorIdConfig.foreignKey).toBe(true);
      expect(authorIdConfig.foreignKeyType).toBe("User");
      expect(authorIdConfig.foreignKeyField).toBe("id");
      expect(authorIdConfig.unique).toBe(false);
      expect(authorIdConfig.index).toBe(true);
    });

    it("should set unique=true for oneToOne relations", () => {
      const user = db.type("User", {
        name: db.string(),
      });

      const profile = db.type("Profile", {
        userId: db.uuid().relation({
          type: "1-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes({ User: user, Profile: profile }, "test-namespace");

      expect(result.Profile.fields.userId.config.unique).toBe(true);
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

      const result = parseTypes({ Node: node }, "test-namespace");

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

      const result = parseTypes({ User: user, Post: post }, "test-namespace");

      // keyOnly should not create relation info
      expect(result.Post.fields.userId.relation).toBeUndefined();
      expect(result.Post.forwardRelationships).toEqual({});
      expect(result.User.backwardRelationships).toEqual({});
    });
  });
});
