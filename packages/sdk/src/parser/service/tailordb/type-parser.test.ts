import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { parseTypes } from "./type-parser";

describe("parseTypes", () => {
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

      expect(result.Employee.backwardRelationships).toHaveProperty(
        "performanceReviews",
      );
      expect(
        result.Employee.backwardRelationships.performanceReviews,
      ).toMatchObject({
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
          { Employee: employee, PerformanceReview: performanceReview },
          "test-namespace",
        ),
      ).toThrow(/Backward relation name conflicts detected/);
      expect(() =>
        parseTypes(
          { Employee: employee, PerformanceReview: performanceReview },
          "test-namespace",
        ),
      ).toThrow(/performanceReviews/);
      expect(() =>
        parseTypes(
          { Employee: employee, PerformanceReview: performanceReview },
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
        { Employee: employee, PerformanceReview: performanceReview },
        "test-namespace",
      );

      expect(result.Employee.backwardRelationships).toHaveProperty(
        "targetReviews",
      );
      expect(result.Employee.backwardRelationships).toHaveProperty(
        "authorReviews",
      );
      expect(result.Employee.backwardRelationships.targetReviews).toMatchObject(
        {
          name: "targetReviews",
          targetType: "PerformanceReview",
          targetField: "targetEmployeeId",
        },
      );
      expect(result.Employee.backwardRelationships.authorReviews).toMatchObject(
        {
          name: "authorReviews",
          targetType: "PerformanceReview",
          targetField: "authorEmployeeId",
        },
      );
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

      const result = parseTypes(
        { User: user, Profile: profile },
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
        parseTypes({ User: user, Post: post }, "test-namespace"),
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
        parseTypes({ User: user, Post: post }, "test-namespace"),
      ).toThrow(/posts/);
    });
  });
});
