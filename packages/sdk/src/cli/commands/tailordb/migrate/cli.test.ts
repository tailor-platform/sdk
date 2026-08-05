import { describe, expect, test } from "vitest";
import {
  generateCommand,
  migrationCommand,
  scriptCommand,
  setCommand,
  statusCommand,
  syncCommand,
  testCommand,
  validateCommand,
} from "./index";

describe("migration CLI commands", () => {
  describe("migrationCommand", () => {
    test("should have correct meta information", () => {
      expect(migrationCommand.name).toBe("migration");
      expect(migrationCommand.description).toContain("migration");
    });

    test.each(["generate", "script", "set", "status", "sync", "test", "validate"])(
      "should have %s subcommand",
      (subCommand) => {
        expect(migrationCommand.subCommands).toHaveProperty(subCommand);
      },
    );
  });

  describe("generateCommand", () => {
    test("should have correct meta information", () => {
      expect(generateCommand.name).toBe("generate");
      expect(generateCommand.description).toContain("migration");
    });

    test("should have required args schema", () => {
      const shape = generateCommand.args.shape;
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("yes");
    });
  });

  describe("setCommand", () => {
    test("should have correct meta information", () => {
      expect(setCommand.name).toBe("set");
      expect(setCommand.description).toContain("migration");
    });

    test("should have required args schema", () => {
      const shape = setCommand.args.shape;
      expect(shape).toHaveProperty("number");
      expect(shape).toHaveProperty("namespace");
      expect(shape).toHaveProperty("yes");
    });
  });

  describe("scriptCommand", () => {
    test("should have correct meta information", () => {
      expect(scriptCommand.name).toBe("script");
      expect(scriptCommand.description).toContain("script");
    });

    test("should have required args schema", () => {
      const shape = scriptCommand.args.shape;
      expect(shape).toHaveProperty("number");
      expect(shape).toHaveProperty("namespace");
      expect(shape).toHaveProperty("no-script");
      expect(shape).toHaveProperty("reason");
    });
  });

  describe("statusCommand", () => {
    test("should have correct meta information", () => {
      expect(statusCommand.name).toBe("status");
      expect(statusCommand.description).toContain("migration");
    });

    test("should have required args schema", () => {
      const shape = statusCommand.args.shape;
      expect(shape).toHaveProperty("namespace");
    });
  });

  describe("syncCommand", () => {
    test("should have correct meta information", () => {
      expect(syncCommand.name).toBe("sync");
      expect(syncCommand.description).toContain("migration snapshot");
    });

    test("should have required args schema", () => {
      const shape = syncCommand.args.shape;
      expect(shape).toHaveProperty("number");
      expect(shape).toHaveProperty("namespace");
      expect(shape).toHaveProperty("yes");
    });
  });

  describe("validateCommand", () => {
    test("should describe its migration-specific validation scope", () => {
      expect(validateCommand.name).toBe("validate");
      expect(validateCommand.description).toContain("full migration history");
      expect(validateCommand.description).toContain(
        "migration and schema-drift checks used by 'deploy'",
      );
      expect(validateCommand.description).not.toContain("same checks as 'deploy'");
    });
  });

  describe("testCommand", () => {
    test("should expose the migration verification inputs", () => {
      expect(testCommand.name).toBe("test");
      expect(testCommand.description).toContain("temporary workspace");
      expect(testCommand.description).toContain("pending migrations");

      const shape = testCommand.args.shape;
      expect(shape).toHaveProperty("data");
      expect(shape).toHaveProperty("target-workspace-id");
      expect(shape).toHaveProperty("assert");
      expect(shape).toHaveProperty("assert-namespace");
      expect(shape).toHaveProperty("machine-user");
      expect(shape).toHaveProperty("yes");
    });
  });
});
