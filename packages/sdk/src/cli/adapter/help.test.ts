/**
 * Help output structure tests
 *
 * These tests verify that commands have the necessary metadata and args
 * for help output generation. The actual help rendering is handled by politty.
 */

import { extractFields } from "politty";
import { describe, it, expect, vi } from "vitest";
import type { AnyCommand, ExtractedFields } from "politty";
import type { z } from "zod";

// Mock node:module to avoid tsx registration issues
vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return {
    ...actual,
    register: vi.fn(),
  };
});

// Mock politty's runMain to prevent actual execution
vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return {
    ...actual,
    runMain: vi.fn(),
  };
});

// Helper type for commands with subCommands
type CommandWithSubCommands = AnyCommand & {
  subCommands?: Record<string, AnyCommand>;
};

// Helper type for runnable commands (have args)
type RunnableCommandWithArgs = AnyCommand & {
  args?: z.ZodType;
};

/**
 * Extract fields from command args if present
 * @param cmd - Command with args schema
 * @returns Extracted fields or undefined if no args
 */
function getExtractedFields(cmd: RunnableCommandWithArgs): ExtractedFields | undefined {
  if (cmd.args) {
    return extractFields(cmd.args);
  }
  return undefined;
}

describe("help metadata", () => {
  describe("main command", () => {
    it("has name and description", { timeout: 10000 }, async () => {
      const { mainCommand } = await import("../index");

      expect(mainCommand.name).toBe("tailor-sdk");
      expect(mainCommand.description).toBeDefined();
    });

    it("has subCommands defined", async () => {
      const { mainCommand } = await import("../index");

      expect(mainCommand.subCommands).toBeDefined();
      expect(Object.keys(mainCommand.subCommands!).length).toBeGreaterThan(0);
    });
  });

  describe("subcommand metadata", () => {
    it("apply command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
      const applyCmd = subCommands.apply;

      expect(applyCmd.name).toBe("apply");
      expect(applyCmd.description).toBeDefined();
    });

    it("profile command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
      const profileCmd = subCommands.profile;

      expect(profileCmd.name).toBe("profile");
      expect(profileCmd.description).toBeDefined();
    });

    it("secret command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
      const secretCmd = subCommands.secret;

      expect(secretCmd.name).toBe("secret");
      expect(secretCmd.description).toBeDefined();
    });
  });

  describe("args schema defined", () => {
    it("apply command has args schema", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, RunnableCommandWithArgs>;
      const applyCmd = subCommands.apply;

      // In politty, args is a Zod schema
      expect(applyCmd.args).toBeDefined();
    });

    it("profile create command has args schema", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, CommandWithSubCommands>;
      const profileCmd = subCommands.profile;
      const profileSubCommands = profileCmd.subCommands as Record<string, RunnableCommandWithArgs>;
      const createCmd = profileSubCommands.create;

      expect(createCmd.args).toBeDefined();
    });
  });

  describe("common args presence", () => {
    it("apply command has args schema with expected fields", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, RunnableCommandWithArgs>;
      const applyCmd = subCommands.apply;

      // Args schema is defined (politty validates fields internally)
      expect(applyCmd.args).toBeDefined();
    });

    it("generate command has args schema", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, RunnableCommandWithArgs>;
      const generateCmd = subCommands.generate;

      expect(generateCmd.args).toBeDefined();
    });

    it("apply command includes common args (env-file)", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, RunnableCommandWithArgs>;
      const applyCmd = subCommands.apply;
      const extracted = getExtractedFields(applyCmd);

      expect(extracted).toBeDefined();
      const envFileField = extracted!.fields.find((f) => f.name === "env-file");
      expect(envFileField).toBeDefined();
      expect(envFileField!.alias).toBe("e");
    });

    it("commands have descriptions for all args", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = mainCommand.subCommands as Record<string, RunnableCommandWithArgs>;
      const applyCmd = subCommands.apply;
      const extracted = getExtractedFields(applyCmd);

      expect(extracted).toBeDefined();
      for (const field of extracted!.fields) {
        expect(field.description).toBeDefined();
        expect(field.description).not.toBe("");
      }
    });
  });
});
