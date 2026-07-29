import { describe, expect, test } from "vitest";
import {
  PENDING_SINCE,
  checkDeprecationTags,
  findDeprecationTags,
  resolvePendingSince,
} from "./deprecation-tags";

const options = {
  codemodIds: new Set(["v2/old-to-new", "v2/other"]),
  currentVersion: "2.0.0-next.10",
};

describe("findDeprecationTags", () => {
  test("reads a single-line tag", () => {
    const source = `/** @deprecated since 1.9.0 — use newApi. codemod: v2/old-to-new */
export const oldApi = 1;
`;

    expect(findDeprecationTags(source)).toEqual([
      { line: 1, text: "since 1.9.0 — use newApi. codemod: v2/old-to-new" },
    ]);
  });

  test("joins continuation lines and stops at the next block tag", () => {
    const source = `/**
 * Does a thing.
 * @deprecated since 1.9.0 — use {@link newApi} instead.
 *   codemod: v2/old-to-new
 * @param value - Ignored
 */
export function oldApi(value: string): void {}
`;

    expect(findDeprecationTags(source)).toEqual([
      {
        line: 3,
        text: "since 1.9.0 — use {@link newApi} instead. codemod: v2/old-to-new",
      },
    ]);
  });

  test("reports each tag with its own line", () => {
    const source = `/** @deprecated since 1.0.0 codemod: v2/old-to-new */
export type A = string;

/** @deprecated since 1.1.0 codemod: v2/other */
export type B = string;
`;

    expect(findDeprecationTags(source).map((tag) => tag.line)).toEqual([1, 4]);
  });

  test("returns nothing when the file has no deprecation", () => {
    expect(findDeprecationTags("export const a = 1;\n")).toEqual([]);
  });

  test("ignores @deprecated outside a JSDoc block", () => {
    const source = `// @deprecated in a line comment
/* @deprecated in a block comment */
export const message = "warn about @deprecated members";
export const template = \`@deprecated\`;
`;

    expect(findDeprecationTags(source)).toEqual([]);
  });

  test("reads a tag that follows a string containing the tag name", () => {
    const source = `const message = "@deprecated";

/** @deprecated since 1.0.0 codemod: v2/old-to-new */
export const oldApi = 1;
`;

    expect(findDeprecationTags(source)).toEqual([
      { line: 3, text: "since 1.0.0 codemod: v2/old-to-new" },
    ]);
  });
});

describe("checkDeprecationTags", () => {
  test("accepts a released version with a registered codemod", () => {
    const source = `/** @deprecated since 1.83.0 — use newApi instead. codemod: v2/old-to-new */
export const oldApi = 1;
`;

    expect(checkDeprecationTags(source, options)).toEqual([]);
  });

  test("accepts the pending sentinel", () => {
    const source = `/** @deprecated since ${PENDING_SINCE} — use newApi instead. codemod: v2/old-to-new */
export const oldApi = 1;
`;

    expect(checkDeprecationTags(source, options)).toEqual([]);
  });

  test("accepts several codemods", () => {
    const source = `/** @deprecated since 1.0.0 — use newApi. codemod: v2/old-to-new, v2/other */
export const oldApi = 1;
`;

    expect(checkDeprecationTags(source, options)).toEqual([]);
  });

  test("rejects a tag without a since", () => {
    const source = "/** @deprecated Use newApi instead. codemod: v2/old-to-new */\n";

    expect(checkDeprecationTags(source, options)).toEqual([
      { line: 1, message: expect.stringContaining("must start with `since <version>`") },
    ]);
  });

  test("rejects a since that is not a version", () => {
    const source = "/** @deprecated since soon — use newApi. codemod: v2/old-to-new */\n";

    expect(checkDeprecationTags(source, options)).toEqual([
      { line: 1, message: expect.stringContaining("`since soon` is not a semver version") },
    ]);
  });

  test("rejects a version the package has not reached yet", () => {
    const source = "/** @deprecated since 2.0.0 — use newApi. codemod: v2/old-to-new */\n";

    expect(checkDeprecationTags(source, options)).toEqual([
      {
        line: 1,
        message: expect.stringContaining("is newer than the current version 2.0.0-next.10"),
      },
    ]);
  });

  test("rejects a tag without a codemod", () => {
    const source = "/** @deprecated since 1.0.0 — use newApi instead. */\n";

    expect(checkDeprecationTags(source, options)).toEqual([
      { line: 1, message: expect.stringContaining("codemod: <id>") },
    ]);
  });

  test("rejects an unregistered codemod id", () => {
    const source = "/** @deprecated since 1.0.0 — use newApi. codemod: v2/does-not-exist */\n";

    expect(checkDeprecationTags(source, options)).toEqual([
      { line: 1, message: expect.stringContaining("`v2/does-not-exist` is not registered") },
    ]);
  });

  test("accepts a codemod id that ends the sentence", () => {
    const source = "/** @deprecated since 1.0.0 — use newApi. codemod: v2/old-to-new. */\n";

    expect(checkDeprecationTags(source, options)).toEqual([]);
  });

  test("reads the id list without swallowing the prose that follows it", () => {
    const source =
      "/** @deprecated since 1.0.0 codemod: v2/old-to-new which also covers the option type. */\n";

    expect(checkDeprecationTags(source, options)).toEqual([]);
  });

  test("reports every violation on a tag", () => {
    const source = "/** @deprecated Use newApi instead. */\n";

    expect(checkDeprecationTags(source, options)).toHaveLength(2);
  });
});

describe("resolvePendingSince", () => {
  test("rewrites every pending marker", () => {
    const source = `/** @deprecated since ${PENDING_SINCE} — use newApi. codemod: v2/old-to-new */
export const a = 1;

/** @deprecated since ${PENDING_SINCE} — use newApi. codemod: v2/other */
export const b = 2;
`;

    const result = resolvePendingSince(source, "2.1.0");

    expect(result.changed).toBe(true);
    expect(result.source).not.toContain(PENDING_SINCE);
    expect(result.source.match(/since 2\.1\.0/g)).toHaveLength(2);
  });

  test("resolves a marker wrapped onto the next JSDoc line", () => {
    const source = `/**
 * @deprecated
 *   since ${PENDING_SINCE} — use newApi. codemod: v2/old-to-new
 */
export const a = 1;
`;

    expect(resolvePendingSince(source, "2.0.0-next.11").source).toContain(
      "since 2.0.0-next.11 — use newApi.",
    );
  });

  test("is a no-op without a pending marker", () => {
    const source = "/** @deprecated since 1.0.0 codemod: v2/old-to-new */\n";

    expect(resolvePendingSince(source, "2.1.0")).toEqual({ changed: false, source });
  });

  test("rejects a resolved version that is not semver", () => {
    expect(() =>
      resolvePendingSince(`/** @deprecated since ${PENDING_SINCE} */\n`, "not-a-version"),
    ).toThrow("must be a valid semver version");
  });
});
