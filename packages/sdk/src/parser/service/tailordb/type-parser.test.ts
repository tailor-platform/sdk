import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { toSchemaOutputs } from "#/utils/test/internal";
import { parseTypes } from "./type-parser";

describe("parseTypes", () => {
  test("allows type names that match Object prototype properties", () => {
    const testType = db.table("toString", {
      value: db.string(),
    });

    const result = parseTypes(toSchemaOutputs({ toString: testType }), "test-namespace");

    expect(Object.hasOwn(result, "toString")).toBe(true);
  });

  test("allows __proto__ as a type name", () => {
    const testType = db.table("__proto__", {
      value: db.string(),
    });

    const result = parseTypes(
      toSchemaOutputs(Object.fromEntries([["__proto__", testType]])),
      "test-namespace",
    );

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
  });

  describe("array field validation", () => {
    test.each([
      ["index", "index cannot be set on array fields"],
      ["unique", "unique cannot be set on array fields"],
    ] as const)("should throw error when %s is set on array field", (metadataKey, message) => {
      // Bypass type check by directly setting metadata
      const field = db.string({ array: true });
      (field as unknown as { _metadata: Record<string, boolean> })._metadata[metadataKey] = true;

      const testType = db.table("Test", {
        tags: field,
      });

      expect(() => parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace")).toThrow(
        `Field "tags" on type "Test": ${message}`,
      );
    });

    test.each([
      ["index", () => db.string().index()],
      ["unique", () => db.string().unique()],
    ] as const)("should allow %s on non-array fields", (metadataKey, buildField) => {
      const testType = db.table("Test", {
        email: buildField(),
      });

      const result = parseTypes(toSchemaOutputs({ Test: testType }), "test-namespace");
      expect(result.Test!.fields.email!.config[metadataKey]).toBe(true);
    });
  });

  describe("buildBackwardRelationships", () => {
    test("should build backward relationships correctly", () => {
      const employee = db.table("Employee", {
        name: db.string(),
      });

      const performanceReview = db.table("PerformanceReview", {
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

      expect(result.Employee!.backwardRelationships).toHaveProperty("performanceReviews");
      expect(result.Employee!.backwardRelationships.performanceReviews).toMatchObject({
        name: "performanceReviews",
        targetType: "PerformanceReview",
        targetField: "employeeId",
        sourceField: "id",
        isArray: true,
      });
    });

    test("should throw error when backward relation names are duplicated", () => {
      const employee = db.table("Employee", {
        name: db.string(),
      });

      // Two fields referencing the same type without explicit backward names
      // Both will generate "performanceReviews" as the backward name
      const performanceReview = db.table("PerformanceReview", {
        targetEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "targetEmployee" },
        }),
        authorEmployeeId: db.uuid().relation({
          type: "n-1",
          toward: { type: employee, as: "authorEmployee" },
        }),
      });

      const run = () =>
        parseTypes(
          toSchemaOutputs({ Employee: employee, PerformanceReview: performanceReview }),
          "test-namespace",
        );

      expect(run).toThrow(/Backward relation name conflicts detected/);
      expect(run).toThrow(/performanceReviews/);
      expect(run).toThrow(/Employee/);
    });

    test("should not throw error when backward names are explicitly set to be unique", () => {
      const employee = db.table("Employee", {
        name: db.string(),
      });

      // Two fields referencing the same type with explicit unique backward names
      const performanceReview = db.table("PerformanceReview", {
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

      expect(result.Employee!.backwardRelationships).toHaveProperty("targetReviews");
      expect(result.Employee!.backwardRelationships).toHaveProperty("authorReviews");
      expect(result.Employee!.backwardRelationships.targetReviews).toMatchObject({
        name: "targetReviews",
        targetType: "PerformanceReview",
        targetField: "targetEmployeeId",
      });
      expect(result.Employee!.backwardRelationships.authorReviews).toMatchObject({
        name: "authorReviews",
        targetType: "PerformanceReview",
        targetField: "authorEmployeeId",
      });
    });

    test("should include source file information in error message when available", () => {
      const employee = db.table("Employee", {
        name: db.string(),
      });

      const performanceReview = db.table("PerformanceReview", {
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

    test("should generate default backward names using inflection", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // No explicit backward name, should generate "posts" (plural of "Post")
      const post = db.table("Post", {
        userId: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      expect(result.User!.backwardRelationships).toHaveProperty("posts");
      expect(result.User!.backwardRelationships.posts).toMatchObject({
        name: "posts",
        targetType: "Post",
        isArray: true,
      });
    });

    test("should generate singular backward name for unique relations", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // Unique relation (1-1), should generate singular "profile"
      const profile = db.table("Profile", {
        userId: db.uuid().relation({
          type: "1-1",
          toward: { type: user },
        }),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.User!.backwardRelationships).toHaveProperty("profile");
      expect(result.User!.backwardRelationships.profile).toMatchObject({
        name: "profile",
        targetType: "Profile",
        isArray: false,
      });
    });

    test.each([
      [
        "existing field",
        () =>
          db.table("User", {
            name: db.string(),
            posts: db.string({ array: true }),
          }),
      ],
      [
        "files field",
        () =>
          db
            .table("User", {
              name: db.string(),
            })
            .files({
              posts: "user posts file",
            }),
      ],
    ] as const)(
      "should throw error when backward name conflicts with %s named 'posts'",
      (_label, buildUser) => {
        const user = buildUser();

        // Post's backward relation will generate "posts" which conflicts
        const post = db.table("Post", {
          userId: db.uuid().relation({
            type: "n-1",
            toward: { type: user },
          }),
        });

        expect(() =>
          parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
        ).toThrow(/posts/);
      },
    );
  });

  describe("forwardRelationships", () => {
    test("should throw error when forward relation names are duplicated", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // Two fields referencing the same type without explicit forward names ("as")
      // Both will generate "user" as the forward name
      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
          backward: "authoredPosts",
        }),
        reviewerID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
          backward: "reviewedPosts",
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/Forward relation name "user".*duplicated.*authorID.*reviewerID/s);
    });

    test("should not throw error when forward names are explicitly set to be unique", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user, as: "author" },
          backward: "authoredPosts",
        }),
        reviewerID: db.uuid().relation({
          type: "n-1",
          toward: { type: user, as: "reviewer" },
          backward: "reviewedPosts",
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      expect(result.Post!.forwardRelationships).toHaveProperty("author");
      expect(result.Post!.forwardRelationships).toHaveProperty("reviewer");
      expect(result.Post!.forwardRelationships.author).toMatchObject({
        name: "author",
        targetType: "User",
        targetField: "authorID",
      });
      expect(result.Post!.forwardRelationships.reviewer).toMatchObject({
        name: "reviewer",
        targetType: "User",
        targetField: "reviewerID",
      });
    });

    test("should throw error when forward name conflicts with existing field", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // Post has a field named "user"
      const post = db.table("Post", {
        user: db.string(),
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/Forward relation name "user".*conflicts with existing field/s);
    });

    test("should throw error when conflicting field is defined after the relation field", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // The conflicting "user" field is defined after authorID in the object
      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
        }),
        user: db.string(),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/Forward relation name "user".*conflicts with existing field/s);
    });

    test("should throw error when forward name equals its own relation field name", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // "as" is set to the same name as the relation field itself: the manifest
      // would end up with both a scalar field and a relationship named "authorID"
      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user, as: "authorID" },
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/Forward relation name "authorID".*is the same as its own relation field/s);
    });

    test("should throw error when forward name conflicts with files field", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // Post has a files field named "avatar"
      const post = db
        .table("Post", {
          authorID: db.uuid().relation({
            type: "n-1",
            toward: { type: user, as: "avatar" },
          }),
        })
        .files({
          avatar: "post avatar file",
        });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
      ).toThrow(/Forward relation name "avatar".*conflicts with files field/s);
    });

    test("should throw error when forward name conflicts with backward name", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
          backward: "authoredPosts",
        }),
      });

      const comment = db.table("Comment", {
        postID: db.uuid().relation({
          type: "n-1",
          toward: { type: post, as: "post" },
          backward: "user",
        }),
      });

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post, Comment: comment }), "test-namespace"),
      ).toThrow(/Relation name "user" on type "Post".*forward.*backward/s);
    });

    test("should include source file information in forward conflict error message", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
        authorID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
          backward: "authoredPosts",
        }),
        reviewerID: db.uuid().relation({
          type: "n-1",
          toward: { type: user },
          backward: "reviewedPosts",
        }),
      });

      const typeSourceInfo = {
        Post: {
          filePath: "/path/to/post.ts",
          exportName: "post",
        },
      };

      expect(() =>
        parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace", typeSourceInfo),
      ).toThrow(/Forward relation name "user".*\/path\/to\/post\.ts/s);
    });

    test("should throw error when self relation forward name is empty", () => {
      const node = db.table("Node", {
        ID: db.uuid().relation({
          type: "n-1",
          toward: { type: "self" },
        }),
      });

      expect(() => parseTypes(toSchemaOutputs({ Node: node }), "test-namespace")).toThrow(
        /Forward relation name for field "ID" on type "Node" cannot be empty/s,
      );
    });
  });

  describe("validateRelationType", () => {
    test("should throw error when relation type is missing", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      // Missing 'type' property - only TypeScript error, need runtime check
      const post = db.table("Post", {
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

    test("should throw error when relation type is invalid", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
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

    test("should throw error when target type does not exist", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
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

    test.each(["oneToOne", "1-1", "manyToOne", "n-1", "N-1", "keyOnly"] as const)(
      "should accept valid relation type %s",
      (relationType) => {
        const user = db.table("User", {
          name: db.string(),
        });

        const post = db.table("Post", {
          userId: db.uuid().relation({
            type: relationType,
            toward: { type: user },
          }),
        });

        expect(() =>
          parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace"),
        ).not.toThrow(/relation type/);
      },
    );
  });

  describe("processRelation", () => {
    test("should compute derived metadata for relations", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
        authorId: db.uuid().relation({
          type: "n-1",
          toward: { type: user, as: "author" },
          backward: "posts",
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      // Check computed metadata on field config
      const authorIdConfig = result.Post!.fields.authorId!.config;
      expect(authorIdConfig.foreignKey).toBe(true);
      expect(authorIdConfig.foreignKeyType).toBe("User");
      expect(authorIdConfig.foreignKeyField).toBe("id");
      expect(authorIdConfig.unique).toBe(false);
      expect(authorIdConfig.index).toBe(true);
    });

    test.each([
      [
        "relation only",
        (user: ReturnType<typeof db.table>) =>
          db.uuid().relation({
            type: "1-1",
            toward: { type: user },
          }),
      ],
      [
        "unique before relation",
        (user: ReturnType<typeof db.table>) =>
          db
            .uuid()
            .unique()
            .relation({
              type: "1-1",
              toward: { type: user },
            }),
      ],
    ] as const)("should set unique=true for oneToOne relations (%s)", (_label, buildUserId) => {
      const user = db.table("User", {
        name: db.string(),
      });

      const profile = db.table("Profile", {
        userId: buildUserId(user),
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.Profile!.fields.userId!.config.unique).toBe(true);
    });

    test("should set unique=true for oneToOne relations (unique after relation)", () => {
      const user = db.table("User", {
        name: db.string(),
      });
      const relatedUserId = db.uuid().relation({
        type: "1-1",
        toward: { type: user },
      });
      // @ts-expect-error - Testing runtime behavior: 1-1 already implies unique, but we test the call order
      const userId = relatedUserId.unique();

      const profile = db.table("Profile", {
        userId,
      });

      const result = parseTypes(
        toSchemaOutputs({ User: user, Profile: profile }),
        "test-namespace",
      );

      expect(result.Profile!.fields.userId!.config.unique).toBe(true);
    });

    test.each([
      [
        "unique before relation",
        (user: ReturnType<typeof db.table>) =>
          db
            .uuid()
            .unique()
            .relation({
              type: "n-1",
              toward: { type: user },
            }),
      ],
      [
        "unique after relation",
        (user: ReturnType<typeof db.table>) =>
          db
            .uuid()
            .relation({
              type: "n-1",
              toward: { type: user },
            })
            .unique(),
      ],
    ] as const)(
      "should throw error when unique is set on n-1 relation (%s)",
      (_label, buildUserId) => {
        const user = db.table("User", {
          name: db.string(),
        });

        const employee = db.table("Employee", {
          userID: buildUserId(user),
        });

        expect(() =>
          parseTypes(toSchemaOutputs({ User: user, Employee: employee }), "test-namespace"),
        ).toThrow(
          'Field "userID" on type "Employee": cannot set unique on n-1 (manyToOne) relation. ' +
            "Use 1-1 (oneToOne) relation instead, or remove the unique constraint.",
        );
      },
    );

    test("should handle self-referencing relations", () => {
      const node = db.table("Node", {
        name: db.string(),
        parentId: db.uuid().relation({
          type: "n-1",
          toward: { type: "self" },
          backward: "children",
        }),
      });

      const result = parseTypes(toSchemaOutputs({ Node: node }), "test-namespace");

      // Check that self-reference is resolved to type name
      expect(result.Node!.fields.parentId!.config.foreignKeyType).toBe("Node");
      expect(result.Node!.fields.parentId!.relation?.targetType).toBe("Node");
    });

    test("should not create forward/backward relationships for keyOnly relations", () => {
      const user = db.table("User", {
        name: db.string(),
      });

      const post = db.table("Post", {
        userId: db.uuid().relation({
          type: "keyOnly",
          toward: { type: user },
        }),
      });

      const result = parseTypes(toSchemaOutputs({ User: user, Post: post }), "test-namespace");

      // keyOnly should not create relation info
      expect(result.Post!.fields.userId!.relation).toBeUndefined();
      expect(result.Post!.forwardRelationships).toEqual({});
      expect(result.User!.backwardRelationships).toEqual({});
    });
  });
});
