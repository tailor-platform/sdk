import { describe, expect, test } from "vitest";
import {
  readTemplateVersionState,
  resolvePendingTemplateVersion,
  templateVersionDrift,
} from "./template-version";

function templatesSource(released: number, changed: boolean, fingerprint: string): string {
  return [
    'import actionTemplate from "./action.yml";',
    "",
    `// Released template fingerprint: ${fingerprint}`,
    `const RELEASED_TEMPLATE_VERSION = ${String(released)};`,
    `const TEMPLATE_CHANGED_SINCE_RELEASE = ${String(changed)};`,
    "export const TEMPLATE_VERSION =",
    "  RELEASED_TEMPLATE_VERSION + (TEMPLATE_CHANGED_SINCE_RELEASE ? 1 : 0);",
  ].join("\n");
}

const OLD = "a".repeat(64);
const NOW = "b".repeat(64);

describe("readTemplateVersionState", () => {
  test("reads the released version, the pending flag, and the fingerprint recorded beside them", () => {
    expect(readTemplateVersionState(templatesSource(13, true, OLD))).toEqual({
      releasedVersion: 13,
      changedSinceRelease: true,
      releasedFingerprint: OLD,
    });
  });

  test("fails instead of guessing when the fingerprint comment is missing", () => {
    const source = templatesSource(13, true, OLD).replace(/^\/\/ Released.*\n/m, "");

    expect(() => readTemplateVersionState(source)).toThrow(/Released template fingerprint/);
  });

  test("fails instead of guessing when the version constants cannot be found", () => {
    expect(() => readTemplateVersionState("export const TEMPLATE_VERSION = 15;")).toThrow(
      /RELEASED_TEMPLATE_VERSION/,
    );
  });
});

describe("resolvePendingTemplateVersion", () => {
  test("is a no-op when no template changed since the last release", () => {
    const source = templatesSource(13, false, OLD);

    expect(resolvePendingTemplateVersion(source, NOW)).toEqual({ changed: false, source });
  });

  test("releases the pending template version with the fingerprint it was released with", () => {
    expect(resolvePendingTemplateVersion(templatesSource(13, true, OLD), NOW)).toEqual({
      changed: true,
      source: templatesSource(14, false, NOW),
      version: 14,
    });
  });

  test("gives the same result however many times a release PR is rebuilt from main", () => {
    const once = resolvePendingTemplateVersion(templatesSource(13, true, OLD), NOW);

    expect(resolvePendingTemplateVersion(once.source, NOW)).toEqual({
      changed: false,
      source: once.source,
    });
  });
});

describe("templateVersionDrift", () => {
  test("accepts unchanged templates while no change is pending", () => {
    expect(
      templateVersionDrift({
        changedSinceRelease: false,
        releasedFingerprint: OLD,
        currentHash: OLD,
      }),
    ).toBeUndefined();
  });

  test("accepts changed templates once the change is marked as pending", () => {
    expect(
      templateVersionDrift({
        changedSinceRelease: true,
        releasedFingerprint: OLD,
        currentHash: NOW,
      }),
    ).toBeUndefined();
  });

  test("asks to mark the change as pending when the templates changed without it", () => {
    expect(
      templateVersionDrift({
        changedSinceRelease: false,
        releasedFingerprint: OLD,
        currentHash: NOW,
      }),
    ).toMatch(/TEMPLATE_CHANGED_SINCE_RELEASE = true/);
  });

  test("asks to clear the pending mark when the templates render as released", () => {
    expect(
      templateVersionDrift({
        changedSinceRelease: true,
        releasedFingerprint: OLD,
        currentHash: OLD,
      }),
    ).toMatch(/TEMPLATE_CHANGED_SINCE_RELEASE = false/);
  });
});
