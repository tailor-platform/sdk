import { describe, expect, test } from "vitest";
import { isGraphQLInputComplete } from "./graphql-repl";

describe("isGraphQLInputComplete", () => {
  test("returns true for a completed single-line query", () => {
    expect(isGraphQLInputComplete("{ viewer { id } }")).toBe(true);
  });

  test("returns true for a completed multiline document", () => {
    expect(
      isGraphQLInputComplete(`
        query Viewer {
          viewer {
            id
          }
        }

        mutation UpdateViewer {
          updateViewer(input: { name: "Alice" }) {
            id
          }
        }

        fragment ViewerFields on Viewer {
          id
          name
        }
      `),
    ).toBe(true);
  });

  test("returns false for incomplete documents", () => {
    expect(isGraphQLInputComplete("{")).toBe(false);
    expect(isGraphQLInputComplete("query Viewer { viewer { id }")).toBe(false);
    expect(
      isGraphQLInputComplete(`
        fragment ViewerFields on Viewer {
          id
      `),
    ).toBe(false);
  });

  test("returns true for completed documents with comments and blank lines", () => {
    expect(
      isGraphQLInputComplete(`
        # viewer query

        query Viewer {
          viewer {
            id
          }
        # }
        }
      `),
    ).toBe(true);
  });

  test("returns false for empty or whitespace-only input", () => {
    expect(isGraphQLInputComplete("")).toBe(false);
    expect(isGraphQLInputComplete("   \n\t")).toBe(false);
  });
});
