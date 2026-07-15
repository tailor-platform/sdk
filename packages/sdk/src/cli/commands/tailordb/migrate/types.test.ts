import { describe, expect, test } from "vitest";
import {
  isValidMigrationNumber,
  formatMigrationNumber,
  getMigrationFilePath,
  getMigrationDirPath,
  MIGRATION_NUMBER_PATTERN,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
  DB_TYPES_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
} from "./snapshot";
import {
  isSchemaError,
  sanitizeMigrationLabel,
  parseMigrationLabelNumber,
  MAX_LABEL_LENGTH,
  MIGRATION_LABEL_PREFIX,
  SCHEMA_ERROR_PATTERNS,
} from "./types";

describe("migration constants", () => {
  test("MAX_LABEL_LENGTH should be 63 (Kubernetes limit)", () => {
    expect(MAX_LABEL_LENGTH).toBe(63);
  });

  test("MIGRATION_LABEL_PREFIX should be 'm'", () => {
    expect(MIGRATION_LABEL_PREFIX).toBe("m");
  });

  test.each([
    ["0001", true],
    ["0100", true],
    ["9999", true],
    ["001", false],
    ["00001", false],
    ["test", false],
    ["", false],
  ])("MIGRATION_NUMBER_PATTERN.test(%j) is %s", (value, expected) => {
    expect(MIGRATION_NUMBER_PATTERN.test(value)).toBe(expected);
  });

  test("SCHEMA_ERROR_PATTERNS should contain expected patterns", () => {
    expect(SCHEMA_ERROR_PATTERNS).toContain("failed to fetch schema");
    expect(SCHEMA_ERROR_PATTERNS).toContain("sqlaccess error");
    expect(SCHEMA_ERROR_PATTERNS).toContain("schema not found");
    expect(SCHEMA_ERROR_PATTERNS).toContain("invalid schema");
  });

  test("file names should be correct for directory structure", () => {
    expect(SCHEMA_FILE_NAME).toBe("schema.json");
    expect(DIFF_FILE_NAME).toBe("diff.json");
    expect(MIGRATE_FILE_NAME).toBe("migrate.ts");
    expect(DB_TYPES_FILE_NAME).toBe("db.ts");
  });

  test("INITIAL_SCHEMA_NUMBER should be 0", () => {
    expect(INITIAL_SCHEMA_NUMBER).toBe(0);
  });
});

describe("isValidMigrationNumber", () => {
  test.each([
    ["0001", true],
    ["0002", true],
    ["0100", true],
    ["9999", true],
    ["001", false], // Too short
    ["1", false], // Too short
    ["00001", false], // Too long
    ["test", false], // Non-numeric
    ["000a", false], // Non-numeric
    ["", false], // Empty string
    ["20260107-123456_test", false], // Old format (timestamp-based)
  ])("isValidMigrationNumber(%j) is %s", (value, expected) => {
    expect(isValidMigrationNumber(value)).toBe(expected);
  });
});

describe("formatMigrationNumber", () => {
  test.each([
    [1, "0001"],
    [2, "0002"],
    [10, "0010"],
    [100, "0100"],
    [1000, "1000"],
    [9999, "9999"],
  ])("formatMigrationNumber(%i) is %j", (value, expected) => {
    expect(formatMigrationNumber(value)).toBe(expected);
  });
});

describe("sanitizeMigrationLabel", () => {
  test.each([
    [1, "m0001"],
    [2, "m0002"],
    [100, "m0100"],
    [9999, "m9999"],
  ])("adds prefix and formats migration number %i as %j", (value, expected) => {
    expect(sanitizeMigrationLabel(value)).toBe(expected);
  });

  test("produces labels that match Kubernetes label pattern", () => {
    // Pattern: ^[a-z][a-z0-9_-]{0,62}
    const result = sanitizeMigrationLabel(1);
    expect(/^[a-z][a-z0-9_-]{0,62}$/.test(result)).toBe(true);
  });
});

describe("parseMigrationLabelNumber", () => {
  test.each([
    ["m0001", 1],
    ["m0002", 2],
    ["m0100", 100],
    ["m9999", 9999],
  ])("parses migration number %j as %i", (label, expected) => {
    expect(parseMigrationLabelNumber(label)).toBe(expected);
  });

  test.each([
    ["0001"], // Missing prefix
    ["x0001"], // Wrong prefix
    ["m"], // No number
    [""],
    ["m0001-extra"], // Trailing garbage
    ["m1x"], // Non-digit suffix
    ["m10000"], // Out of range
  ])("returns null for invalid label %j", (label) => {
    expect(parseMigrationLabelNumber(label)).toBe(null);
  });
});

describe("getMigrationDirPath", () => {
  test.each([
    [0, "/migrations/tailordb/0000"],
    [1, "/migrations/tailordb/0001"],
    [10, "/migrations/tailordb/0010"],
  ])("returns correct directory path for number %i", (number, expected) => {
    expect(getMigrationDirPath("/migrations/tailordb", number)).toBe(expected);
  });
});

describe("getMigrationFilePath", () => {
  test.each([
    [0, "schema", "/migrations/tailordb/0000/schema.json"],
    [1, "schema", "/migrations/tailordb/0001/schema.json"],
    [1, "diff", "/migrations/tailordb/0001/diff.json"],
    [2, "diff", "/migrations/tailordb/0002/diff.json"],
    [1, "migrate", "/migrations/tailordb/0001/migrate.ts"],
    [3, "migrate", "/migrations/tailordb/0003/migrate.ts"],
    [1, "db", "/migrations/tailordb/0001/db.ts"],
  ] as const)("returns correct path for number %i, kind %s", (number, kind, expected) => {
    expect(getMigrationFilePath("/migrations/tailordb", number, kind)).toBe(expected);
  });
});

describe("isSchemaError", () => {
  test.each([
    ["failed to fetch schema", true],
    ["sqlaccess error: connection failed", true],
    ["schema not found in database", true],
    ["invalid schema structure", true],
    ["FAILED TO FETCH SCHEMA", true],
    ["SQLAccess Error", true],
    ["Schema Not Found", true],
    ["Invalid SCHEMA", true],
    ["network timeout", false],
    ["authentication failed", false],
    ["permission denied", false],
    ["", false],
    ["Error: failed to fetch schema for type User", true],
    ["Database sqlaccess error occurred during migration", true],
  ])("isSchemaError(%j) is %s", (message, expected) => {
    expect(isSchemaError(message)).toBe(expected);
  });
});
