import { describe, expect, it } from "vitest";
import { generateCommand, migrationCommand, setCommand, statusCommand, syncCommand } from "./index";

describe("migration CLI commands", () => {
  describe("migrationCommand", () => {
    it("should have correct meta information", () => {
      expect(migrationCommand.name).toBe("migration");
      expect(migrationCommand.description).toContain("migration");
    });

    it("should have generate subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("generate");
    });

    it("should have set subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("set");
    });

    it("should have status subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("status");
    });

    it("should have sync subcommand", () => {
      expect(migrationCommand.subCommands).toHaveProperty("sync");
    });
  });

  describe("generateCommand", () => {
    it("should have correct meta information", () => {
      expect(generateCommand.name).toBe("generate");
      expect(generateCommand.description).toContain("migration");
    });

    it("should have required args schema", () => {
      const shape = generateCommand.args.shape;
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("yes");
    });
  });

  describe("setCommand", () => {
    it("should have correct meta information", () => {
      expect(setCommand.name).toBe("set");
      expect(setCommand.description).toContain("migration");
    });

    it("should have required args schema", () => {
      const shape = setCommand.args.shape;
      expect(shape).toHaveProperty("number");
      expect(shape).toHaveProperty("namespace");
      expect(shape).toHaveProperty("yes");
    });
  });

  describe("statusCommand", () => {
    it("should have correct meta information", () => {
      expect(statusCommand.name).toBe("status");
      expect(statusCommand.description).toContain("migration");
    });

    it("should have required args schema", () => {
      const shape = statusCommand.args.shape;
      expect(shape).toHaveProperty("namespace");
    });
  });

  describe("syncCommand", () => {
    it("should have correct meta information", () => {
      expect(syncCommand.name).toBe("sync");
      expect(syncCommand.description).toContain("migration snapshot");
    });

    it("should have required args schema", () => {
      const shape = syncCommand.args.shape;
      expect(shape).toHaveProperty("number");
      expect(shape).toHaveProperty("namespace");
      expect(shape).toHaveProperty("yes");
    });
  });
});
