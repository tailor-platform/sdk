import { describe, expect, it } from "vitest";
import {
  isValidMigrationNumber,
  isSchemaError,
  formatMigrationNumber,
  parseMigrationNumber,
  sanitizeMigrationLabel,
  parseMigrationLabelNumber,
  getMigrationFilePath,
  getMigrationDirPath,
  MAX_LABEL_LENGTH,
  MIGRATION_LABEL_PREFIX,
  MIGRATION_NUMBER_PATTERN,
  SCHEMA_ERROR_PATTERNS,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
  DB_TYPES_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
} from "./types";

describe("migration constants", () => {
  it("MAX_LABEL_LENGTH should be 63 (Kubernetes limit)", () => {
    expect(MAX_LABEL_LENGTH).toBe(63);
  });

  it("MIGRATION_LABEL_PREFIX should be 'm'", () => {
    expect(MIGRATION_LABEL_PREFIX).toBe("m");
  });

  it("MIGRATION_NUMBER_PATTERN should match 4-digit format", () => {
    expect(MIGRATION_NUMBER_PATTERN.test("0001")).toBe(true);
    expect(MIGRATION_NUMBER_PATTERN.test("0100")).toBe(true);
    expect(MIGRATION_NUMBER_PATTERN.test("9999")).toBe(true);
    // Invalid formats
    expect(MIGRATION_NUMBER_PATTERN.test("001")).toBe(false);
    expect(MIGRATION_NUMBER_PATTERN.test("00001")).toBe(false);
    expect(MIGRATION_NUMBER_PATTERN.test("test")).toBe(false);
    expect(MIGRATION_NUMBER_PATTERN.test("")).toBe(false);
  });

  it("SCHEMA_ERROR_PATTERNS should contain expected patterns", () => {
    expect(SCHEMA_ERROR_PATTERNS).toContain("failed to fetch schema");
    expect(SCHEMA_ERROR_PATTERNS).toContain("sqlaccess error");
    expect(SCHEMA_ERROR_PATTERNS).toContain("schema not found");
    expect(SCHEMA_ERROR_PATTERNS).toContain("invalid schema");
  });

  it("file names should be correct for directory structure", () => {
    expect(SCHEMA_FILE_NAME).toBe("schema.json");
    expect(DIFF_FILE_NAME).toBe("diff.json");
    expect(MIGRATE_FILE_NAME).toBe("migrate.ts");
    expect(DB_TYPES_FILE_NAME).toBe("db.ts");
  });

  it("INITIAL_SCHEMA_NUMBER should be 0", () => {
    expect(INITIAL_SCHEMA_NUMBER).toBe(0);
  });
});

describe("isValidMigrationNumber", () => {
  it("returns true for valid migration numbers", () => {
    expect(isValidMigrationNumber("0001")).toBe(true);
    expect(isValidMigrationNumber("0002")).toBe(true);
    expect(isValidMigrationNumber("0100")).toBe(true);
    expect(isValidMigrationNumber("9999")).toBe(true);
  });

  it("returns false for invalid migration numbers", () => {
    // Too short
    expect(isValidMigrationNumber("001")).toBe(false);
    expect(isValidMigrationNumber("1")).toBe(false);

    // Too long
    expect(isValidMigrationNumber("00001")).toBe(false);

    // Non-numeric
    expect(isValidMigrationNumber("test")).toBe(false);
    expect(isValidMigrationNumber("000a")).toBe(false);

    // Empty string
    expect(isValidMigrationNumber("")).toBe(false);

    // Old format (timestamp-based)
    expect(isValidMigrationNumber("20260107-123456_test")).toBe(false);
  });
});

describe("formatMigrationNumber", () => {
  it("formats numbers with 4-digit padding", () => {
    expect(formatMigrationNumber(1)).toBe("0001");
    expect(formatMigrationNumber(2)).toBe("0002");
    expect(formatMigrationNumber(10)).toBe("0010");
    expect(formatMigrationNumber(100)).toBe("0100");
    expect(formatMigrationNumber(1000)).toBe("1000");
    expect(formatMigrationNumber(9999)).toBe("9999");
  });
});

describe("parseMigrationNumber", () => {
  it("parses migration number from valid file names", () => {
    expect(parseMigrationNumber("0001_schema.json")).toBe(1);
    expect(parseMigrationNumber("0002_diff.json")).toBe(2);
    expect(parseMigrationNumber("0010_migrate.ts")).toBe(10);
    expect(parseMigrationNumber("0100_schema.json")).toBe(100);
  });

  it("returns null for invalid file names", () => {
    expect(parseMigrationNumber("schema.json")).toBe(null);
    expect(parseMigrationNumber("invalid_schema.json")).toBe(null);
    expect(parseMigrationNumber("001_schema.json")).toBe(null); // Too few digits
    expect(parseMigrationNumber("")).toBe(null);
  });
});

describe("sanitizeMigrationLabel", () => {
  it("adds prefix and formats migration number", () => {
    expect(sanitizeMigrationLabel(1)).toBe("m0001");
    expect(sanitizeMigrationLabel(2)).toBe("m0002");
    expect(sanitizeMigrationLabel(100)).toBe("m0100");
    expect(sanitizeMigrationLabel(9999)).toBe("m9999");
  });

  it("produces labels that match Kubernetes label pattern", () => {
    // Pattern: ^[a-z][a-z0-9_-]{0,62}
    const result = sanitizeMigrationLabel(1);
    expect(/^[a-z][a-z0-9_-]{0,62}$/.test(result)).toBe(true);
  });
});

describe("parseMigrationLabelNumber", () => {
  it("parses migration number from valid labels", () => {
    expect(parseMigrationLabelNumber("m0001")).toBe(1);
    expect(parseMigrationLabelNumber("m0002")).toBe(2);
    expect(parseMigrationLabelNumber("m0100")).toBe(100);
    expect(parseMigrationLabelNumber("m9999")).toBe(9999);
  });

  it("returns null for invalid labels", () => {
    expect(parseMigrationLabelNumber("0001")).toBe(null); // Missing prefix
    expect(parseMigrationLabelNumber("x0001")).toBe(null); // Wrong prefix
    expect(parseMigrationLabelNumber("m")).toBe(null); // No number
    expect(parseMigrationLabelNumber("")).toBe(null);
  });
});

describe("getMigrationDirPath", () => {
  it("returns correct directory path", () => {
    expect(getMigrationDirPath("/migrations/tailordb", 0)).toBe("/migrations/tailordb/0000");
    expect(getMigrationDirPath("/migrations/tailordb", 1)).toBe("/migrations/tailordb/0001");
    expect(getMigrationDirPath("/migrations/tailordb", 10)).toBe("/migrations/tailordb/0010");
  });
});

describe("getMigrationFilePath", () => {
  it("returns correct path for schema files (directory structure)", () => {
    expect(getMigrationFilePath("/migrations/tailordb", 0, "schema")).toBe(
      "/migrations/tailordb/0000/schema.json",
    );
    expect(getMigrationFilePath("/migrations/tailordb", 1, "schema")).toBe(
      "/migrations/tailordb/0001/schema.json",
    );
  });

  it("returns correct path for diff files (directory structure)", () => {
    expect(getMigrationFilePath("/migrations/tailordb", 1, "diff")).toBe(
      "/migrations/tailordb/0001/diff.json",
    );
    expect(getMigrationFilePath("/migrations/tailordb", 2, "diff")).toBe(
      "/migrations/tailordb/0002/diff.json",
    );
  });

  it("returns correct path for migrate files (directory structure)", () => {
    expect(getMigrationFilePath("/migrations/tailordb", 1, "migrate")).toBe(
      "/migrations/tailordb/0001/migrate.ts",
    );
    expect(getMigrationFilePath("/migrations/tailordb", 3, "migrate")).toBe(
      "/migrations/tailordb/0003/migrate.ts",
    );
  });

  it("returns correct path for db types files (directory structure)", () => {
    expect(getMigrationFilePath("/migrations/tailordb", 1, "db")).toBe(
      "/migrations/tailordb/0001/db.ts",
    );
  });
});

describe("isSchemaError", () => {
  it("returns true for messages containing schema error patterns", () => {
    expect(isSchemaError("failed to fetch schema")).toBe(true);
    expect(isSchemaError("sqlaccess error: connection failed")).toBe(true);
    expect(isSchemaError("schema not found in database")).toBe(true);
    expect(isSchemaError("invalid schema structure")).toBe(true);
  });

  it("returns true for case-insensitive matches", () => {
    expect(isSchemaError("FAILED TO FETCH SCHEMA")).toBe(true);
    expect(isSchemaError("SQLAccess Error")).toBe(true);
    expect(isSchemaError("Schema Not Found")).toBe(true);
    expect(isSchemaError("Invalid SCHEMA")).toBe(true);
  });

  it("returns false for non-schema errors", () => {
    expect(isSchemaError("network timeout")).toBe(false);
    expect(isSchemaError("authentication failed")).toBe(false);
    expect(isSchemaError("permission denied")).toBe(false);
    expect(isSchemaError("")).toBe(false);
  });

  it("returns true when error pattern is part of longer message", () => {
    expect(isSchemaError("Error: failed to fetch schema for type User")).toBe(true);
    expect(isSchemaError("Database sqlaccess error occurred during migration")).toBe(true);
  });
});
