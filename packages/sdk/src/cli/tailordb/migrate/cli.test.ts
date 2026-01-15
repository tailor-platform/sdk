import { describe, expect, it } from "vitest";
import { generateCommand, migrationCommand, setCommand, statusCommand } from "./index";
import type { CommandMeta } from "citty";

// Helper to resolve citty Resolvable types for testing
type ResolvedArgs<T> = T extends (...args: unknown[]) => infer R ? Awaited<R> : Awaited<T>;

describe("migration CLI commands", () => {
  describe("migrationCommand", () => {
    it("should have correct meta information", () => {
      const meta = migrationCommand.meta as CommandMeta;
      expect(meta?.name).toBe("migration");
      expect(meta?.description).toContain("migration");
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
  });

  describe("generateCommand", () => {
    it("should have correct meta information", () => {
      const meta = generateCommand.meta as CommandMeta;
      expect(meta?.name).toBe("generate");
      expect(meta?.description).toContain("migration");
    });

    it("should have required args", () => {
      const args = generateCommand.args as ResolvedArgs<typeof generateCommand.args>;
      expect(args).toHaveProperty("name");
      expect(args).toHaveProperty("yes");
    });

    it("should have name option with alias", () => {
      const args = generateCommand.args as ResolvedArgs<typeof generateCommand.args>;
      const nameArg = args?.name;
      expect(nameArg?.type).toBe("string");
      expect(nameArg?.alias).toBe("n");
    });

    it("should have yes flag with alias", () => {
      const args = generateCommand.args as ResolvedArgs<typeof generateCommand.args>;
      const yesArg = args?.yes;
      expect(yesArg?.type).toBe("boolean");
      expect(yesArg?.alias).toBe("y");
      expect(yesArg?.default).toBe(false);
    });
  });

  describe("setCommand", () => {
    it("should have correct meta information", () => {
      const meta = setCommand.meta as CommandMeta;
      expect(meta?.name).toBe("set");
      expect(meta?.description).toContain("migration");
    });

    it("should have required args", () => {
      const args = setCommand.args as ResolvedArgs<typeof setCommand.args>;
      expect(args).toHaveProperty("number");
      expect(args).toHaveProperty("namespace");
      expect(args).toHaveProperty("yes");
    });
  });

  describe("statusCommand", () => {
    it("should have correct meta information", () => {
      const meta = statusCommand.meta as CommandMeta;
      expect(meta?.name).toBe("status");
      expect(meta?.description).toContain("migration");
    });

    it("should have required args", () => {
      const args = statusCommand.args as ResolvedArgs<typeof statusCommand.args>;
      expect(args).toHaveProperty("namespace");
    });
  });
});
