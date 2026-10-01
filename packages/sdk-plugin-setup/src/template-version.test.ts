import { describe, expect, test } from "vitest";
import { resolvePendingTemplateVersion, templateVersionDrift } from "./template-version";

function templatesSource(released: number, changed: boolean): string {
  return [
    'import actionTemplate from "./action.yml";',
    "",
    `const RELEASED_TEMPLATE_VERSION = ${String(released)};`,
    `const TEMPLATE_CHANGED_SINCE_RELEASE = ${String(changed)};`,
    "export const TEMPLATE_VERSION =",
    "  RELEASED_TEMPLATE_VERSION + (TEMPLATE_CHANGED_SINCE_RELEASE ? 1 : 0);",
  ].join("\n");
}

describe("resolvePendingTemplateVersion", () => {
  test("is a no-op when no template changed since the last release", () => {
    const source = templatesSource(13, false);

    expect(resolvePendingTemplateVersion(source, "hash-now")).toEqual({ changed: false, source });
  });

  test("releases the pending template version and records the fingerprint it was released with", () => {
    const result = resolvePendingTemplateVersion(templatesSource(13, true), "hash-now");

    expect(result).toEqual({
      changed: true,
      source: templatesSource(14, false),
      fingerprint: { version: 14, hash: "hash-now" },
    });
  });

  test("gives the same result however many times a release PR is rebuilt from main", () => {
    const once = resolvePendingTemplateVersion(templatesSource(13, true), "hash-now");
    const twice = resolvePendingTemplateVersion(once.source, "hash-now");

    expect(twice).toEqual({ changed: false, source: once.source });
  });

  test("fails instead of guessing when the version constants cannot be found", () => {
    expect(() => resolvePendingTemplateVersion("export const TEMPLATE_VERSION = 15;", "h")).toThrow(
      /RELEASED_TEMPLATE_VERSION/,
    );
  });
});

describe("templateVersionDrift", () => {
  const recorded = { version: 13, hash: "released-hash" };

  test("accepts unchanged templates while no change is pending", () => {
    expect(
      templateVersionDrift({
        releasedVersion: 13,
        changedSinceRelease: false,
        recorded,
        currentHash: "released-hash",
      }),
    ).toBeUndefined();
  });

  test("accepts changed templates once the change is marked as pending", () => {
    expect(
      templateVersionDrift({
        releasedVersion: 13,
        changedSinceRelease: true,
        recorded,
        currentHash: "new-hash",
      }),
    ).toBeUndefined();
  });

  test("asks to mark the change as pending when the templates changed without it", () => {
    expect(
      templateVersionDrift({
        releasedVersion: 13,
        changedSinceRelease: false,
        recorded,
        currentHash: "new-hash",
      }),
    ).toMatch(/TEMPLATE_CHANGED_SINCE_RELEASE = true/);
  });

  test("asks to clear the pending mark when the templates render as released", () => {
    expect(
      templateVersionDrift({
        releasedVersion: 13,
        changedSinceRelease: true,
        recorded,
        currentHash: "released-hash",
      }),
    ).toMatch(/TEMPLATE_CHANGED_SINCE_RELEASE = false/);
  });

  test("rejects a fingerprint recorded for a different released version", () => {
    expect(
      templateVersionDrift({
        releasedVersion: 14,
        changedSinceRelease: false,
        recorded,
        currentHash: "released-hash",
      }),
    ).toMatch(/version 13.*RELEASED_TEMPLATE_VERSION is 14/);
  });
});
