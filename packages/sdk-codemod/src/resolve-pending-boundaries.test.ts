import { describe, expect, test } from "vitest";
import { resolvePendingBoundaries } from "./resolve-pending-boundaries";

const V2_NEXT_4_DECL = 'const V2_NEXT_4 = "2.0.0-next.4";';
const PENDING_DECL = 'export const V2_NEXT_PENDING = "pending";';

function registrySource(...extraLines: string[]): string {
  return [V2_NEXT_4_DECL, PENDING_DECL, ...extraLines].join("\n");
}

describe("resolvePendingBoundaries", () => {
  test("is a no-op when no codemod references V2_NEXT_PENDING", () => {
    const source = registrySource("    prereleaseUntil: V2_NEXT_4,");
    const result = resolvePendingBoundaries(source, "2.0.0-next.5");

    expect(result).toEqual({ changed: false, source });
  });

  test("inserts the resolved constant and rewrites usages", () => {
    const source = registrySource("    prereleaseUntil: V2_NEXT_PENDING,");
    const result = resolvePendingBoundaries(source, "2.0.0-next.5");

    expect(result.changed).toBe(true);
    expect(result.constantName).toBe("V2_NEXT_5");
    expect(result.source).toContain('const V2_NEXT_5 = "2.0.0-next.5";');
    expect(result.source).toContain(PENDING_DECL);
    expect(result.source).toContain("prereleaseUntil: V2_NEXT_5,");
    expect(result.source).not.toContain("V2_NEXT_PENDING,");
  });

  test("rewrites every pending usage in the same resolution", () => {
    const source = registrySource(
      "    prereleaseUntil: V2_NEXT_PENDING,",
      "    prereleaseUntil: V2_NEXT_PENDING,",
    );
    const result = resolvePendingBoundaries(source, "2.0.0-next.5");

    expect(result.source.match(/prereleaseUntil: V2_NEXT_5,/g)).toHaveLength(2);
    expect(result.source.match(/const V2_NEXT_5 = /g)).toHaveLength(1);
  });

  test("reuses an already-declared constant instead of duplicating it", () => {
    const source = [
      'const V2_NEXT_5 = "2.0.0-next.5";',
      PENDING_DECL,
      "    prereleaseUntil: V2_NEXT_PENDING,",
    ].join("\n");
    const result = resolvePendingBoundaries(source, "2.0.0-next.5");

    expect(result.source.match(/const V2_NEXT_5 = /g)).toHaveLength(1);
    expect(result.source).toContain("prereleaseUntil: V2_NEXT_5,");
  });

  test("throws when the existing constant points at a different version", () => {
    const source = [
      'const V2_NEXT_5 = "2.0.0-next.99";',
      PENDING_DECL,
      "    prereleaseUntil: V2_NEXT_PENDING,",
    ].join("\n");

    expect(() => resolvePendingBoundaries(source, "2.0.0-next.5")).toThrow(
      "V2_NEXT_5 is already declared as 2.0.0-next.99",
    );
  });

  test("throws when the resolved version is not a next.N prerelease", () => {
    const source = registrySource("    prereleaseUntil: V2_NEXT_PENDING,");

    expect(() => resolvePendingBoundaries(source, "2.0.0")).toThrow(
      'resolvedVersion must be a "next.N" prerelease',
    );
  });

  test("throws when the resolved version is not valid semver", () => {
    const source = registrySource("    prereleaseUntil: V2_NEXT_PENDING,");

    expect(() => resolvePendingBoundaries(source, "not-a-version")).toThrow(
      "resolvedVersion must be a valid semver version",
    );
  });
});
