import path from "node:path";
import { isObject } from "./utils";
import { isExcludedWorkspacePath } from "./workspace-files";

export type VerifySpec = {
  schemaVersion: 1;
  checks: VerifySpecCheck[];
};

type ContentPatternCheckBase = {
  id: string;
  description?: string;
  glob: string;
  pattern: string;
  flags?: string;
};

type ContentMatchCheck = ContentPatternCheckBase & {
  kind: "content-match";
  /**
   * Minimum number of glob-matching files that must contain the pattern (default 1).
   * Counts files, not occurrences: a single file with several matches counts once.
   */
  minMatches?: number;
};

type ContentAbsentCheck = ContentPatternCheckBase & {
  kind: "content-absent";
};

export type VerifySpecCheck =
  | {
      id: string;
      kind: "file-exists";
      description?: string;
      path: string;
    }
  | {
      id: string;
      kind: "file-glob";
      description?: string;
      glob: string;
      minCount?: number;
    }
  | ContentMatchCheck
  | ContentAbsentCheck;

export const BUILT_IN_VERIFICATION_CHECK_IDS = {
  problemVerifySpec: "problem-verify-spec",
  sdkApiTailorConfig: "sdk-api-tailor-config",
  typescriptNoEmit: "typescript-no-emit",
  workspacePackageJson: "workspace-package-json",
} as const;

const ROOT_FIELDS = new Set(["schemaVersion", "checks"]);
const COMMON_CHECK_FIELDS = ["id", "kind", "description"];
const RESERVED_CHECK_IDS = new Set<string>(Object.values(BUILT_IN_VERIFICATION_CHECK_IDS));
const CHECK_FIELDS: Record<VerifySpecCheck["kind"], Set<string>> = {
  "file-exists": new Set([...COMMON_CHECK_FIELDS, "path"]),
  "file-glob": new Set([...COMMON_CHECK_FIELDS, "glob", "minCount"]),
  "content-match": new Set([...COMMON_CHECK_FIELDS, "glob", "pattern", "flags", "minMatches"]),
  "content-absent": new Set([...COMMON_CHECK_FIELDS, "glob", "pattern", "flags"]),
};

export function parseVerificationSpec(contents: string): VerifySpec {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`verify.json must contain valid JSON: ${errorMessage(error)}`);
  }

  if (!isObject(value)) {
    throw new Error("verify.json must contain an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("verify.json schemaVersion must be 1");
  }
  if (!Array.isArray(value.checks)) {
    throw new Error("verify.json checks must be an array");
  }
  assertAllowedFields(value, ROOT_FIELDS, "verify.json");

  const checkIndexes = new Map<string, number>();
  const checks: VerifySpecCheck[] = [];
  for (const [index, check] of value.checks.entries()) {
    const context = `verify.json checks[${index}]`;
    validateCheck(check, context);
    const previousIndex = checkIndexes.get(check.id);
    if (previousIndex !== undefined) {
      throw new Error(`${context}.id duplicates verify.json checks[${previousIndex}].id`);
    }
    checkIndexes.set(check.id, index);
    checks.push(check);
  }

  return { schemaVersion: 1, checks };
}

function validateCheck(value: unknown, context: string): asserts value is VerifySpecCheck {
  if (!isObject(value)) {
    throw new Error(`${context} must be an object`);
  }
  assertNonEmptyString(value.id, `${context}.id`, true);
  if (RESERVED_CHECK_IDS.has(value.id)) {
    throw new Error(`${context}.id is reserved`);
  }
  assertOptionalString(value.description, `${context}.description`);

  if (
    value.kind !== "file-exists" &&
    value.kind !== "file-glob" &&
    value.kind !== "content-match" &&
    value.kind !== "content-absent"
  ) {
    throw new Error(`${context}.kind is not supported`);
  }
  assertAllowedFields(value, CHECK_FIELDS[value.kind], context);

  if (value.kind === "file-exists") {
    assertWorkspaceRelative(value.path, `${context}.path`);
    return;
  }

  assertWorkspaceRelative(value.glob, `${context}.glob`);
  if (value.kind === "file-glob") {
    assertOptionalPositiveInteger(value.minCount, `${context}.minCount`);
    return;
  }

  assertNonEmptyString(value.pattern, `${context}.pattern`);
  assertOptionalString(value.flags, `${context}.flags`);
  assertValidRegExp(value.pattern, value.flags, context);
  if (value.kind === "content-match") {
    assertOptionalPositiveInteger(value.minMatches, `${context}.minMatches`);
  }
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
  context: string,
): void {
  const unknownField = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unknownField !== undefined) {
    throw new Error(`${context}.${unknownField} is not supported`);
  }
}

function assertNonEmptyString(
  value: unknown,
  context: string,
  trim = false,
): asserts value is string {
  if (typeof value !== "string" || (trim ? value.trim() : value).length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
}

function assertOptionalString(
  value: unknown,
  context: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${context} must be a string when provided`);
  }
}

function assertOptionalPositiveInteger(
  value: unknown,
  context: string,
): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
    throw new Error(`${context} must be a positive integer when provided`);
  }
}

function assertWorkspaceRelative(value: unknown, context: string): asserts value is string {
  assertNonEmptyString(value, context);
  const segments = value.split(/[\\/]/u);
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || segments.includes("..")) {
    throw new Error(`${context} must stay within the workspace`);
  }
  const normalizedPath = path.posix.normalize(value.replaceAll("\\", "/"));
  if (isExcludedWorkspacePath(normalizedPath)) {
    throw new Error(`${context} must not reference excluded workspace paths`);
  }
}

function assertValidRegExp(pattern: string, flags: string | undefined, context: string): void {
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`${context} must contain a valid regular expression: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
