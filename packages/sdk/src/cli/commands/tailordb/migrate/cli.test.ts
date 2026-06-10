import { describe, expect, test } from "vitest";
import {
  generateCommand,
  migrationCommand,
  scriptCommand,
  setCommand,
  statusCommand,
  syncCommand,
} from "./index";

describe("migration CLI commands", () => {
  describe("migrationCommand", () => {
    test("should have correct meta information", () => {
      expect(migrationCommand.name).toBe("migration");
      expect(migrationCommand.description).toContain("migration");
    });

    test("should have generate subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("generate");
    });

    test("should have script subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("script");
    });

    test("should have set subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("set");
    });

    test("should have status subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("status");
    });

    test("should have sync subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("sync");
    });
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
});
