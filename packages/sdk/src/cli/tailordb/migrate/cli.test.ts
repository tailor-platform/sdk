import { describe, expect, it } from "vitest";
import { generateCommand, migrateCommand } from "./index";
import type { CommandMeta } from "citty";

// Helper to resolve citty Resolvable types for testing
type ResolvedArgs<T> = T extends (...args: unknown[]) => infer R ? Awaited<R> : Awaited<T>;

describe("migrate CLI commands", () => {
  describe("migrateCommand", () => {
    it("should have correct meta information", () => {
      const meta = migrateCommand.meta as CommandMeta;
      expect(meta?.name).toBe("migrate");
      expect(meta?.description).toContain("migration");
    });

    it("should have generate subcommand", () => {
      expect(migrateCommand.subCommands).toHaveProperty("generate");
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
});
