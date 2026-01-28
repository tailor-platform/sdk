/**
 * Help output structure tests
 *
 * These tests verify that commands have the necessary metadata and args
 * for help output generation. The actual help rendering is handled by citty.
 */

import { describe, it, expect, vi } from "vitest";
import type { CommandDef, Resolvable, SubCommandsDef, ArgsDef, CommandMeta } from "citty";

// Mock node:module to avoid tsx registration issues
vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return {
    ...actual,
    register: vi.fn(),
  };
});

// Mock citty's runMain to prevent actual execution
vi.mock("citty", async () => {
  const actual = await vi.importActual("citty");
  return {
    ...actual,
    runMain: vi.fn(),
  };
});

// Helper to resolve a command
// oxlint-disable-next-line no-explicit-any
async function resolveCommand<T extends CommandDef<any>>(cmd: Resolvable<T>): Promise<T> {
  if (typeof cmd === "function") {
    return await cmd();
  }
  return await cmd;
}

// Helper to resolve subcommands
async function resolveSubCommands(
  subCommands: Resolvable<SubCommandsDef>,
): Promise<SubCommandsDef> {
  if (typeof subCommands === "function") {
    return await subCommands();
  }
  return await subCommands;
}

// Helper to resolve args
async function resolveArgs(args: Resolvable<ArgsDef>): Promise<ArgsDef> {
  if (typeof args === "function") {
    return await args();
  }
  return await args;
}

// Helper to resolve meta
async function resolveMeta(meta: Resolvable<CommandMeta>): Promise<CommandMeta> {
  if (typeof meta === "function") {
    return await meta();
  }
  return await meta;
}

describe("help metadata", () => {
  describe("main command", () => {
    it("has name and description in meta", { timeout: 10000 }, async () => {
      const { mainCommand } = await import("../index");

      const meta = await resolveMeta(mainCommand.meta!);
      expect(meta).toBeDefined();
      expect(meta.name).toBe("tailor-sdk");
      expect(meta.description).toBeDefined();
      expect(meta.version).toBeDefined();
    });

    it("has subCommands defined", async () => {
      const { mainCommand } = await import("../index");

      expect(mainCommand.subCommands).toBeDefined();
      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      expect(Object.keys(subCommands).length).toBeGreaterThan(0);
    });
  });

  describe("subcommand meta", () => {
    it("apply command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const applyCmd = await resolveCommand(subCommands.apply);
      const meta = await resolveMeta(applyCmd.meta!);

      expect(meta).toBeDefined();
      expect(meta.name).toBe("apply");
      expect(meta.description).toBeDefined();
    });

    it("profile command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const profileCmd = await resolveCommand(subCommands.profile);
      const meta = await resolveMeta(profileCmd.meta!);

      expect(meta).toBeDefined();
      expect(meta.name).toBe("profile");
      expect(meta.description).toBeDefined();
    });

    it("secret command has name and description", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const secretCmd = await resolveCommand(subCommands.secret);
      const meta = await resolveMeta(secretCmd.meta!);

      expect(meta).toBeDefined();
      expect(meta.name).toBe("secret");
      expect(meta.description).toBeDefined();
    });
  });

  describe("args have descriptions", () => {
    it("apply command args have descriptions", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const applyCmd = await resolveCommand(subCommands.apply);
      const args = await resolveArgs(applyCmd.args!);

      expect(args).toBeDefined();
      // Check config arg
      expect(args.config).toBeDefined();
      expect(args.config.description).toBeDefined();
      expect(args.config.description).toBeTruthy();
    });

    it("profile create command args have descriptions", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const profileCmd = await resolveCommand(subCommands.profile);
      const profileSubCommands = await resolveSubCommands(profileCmd.subCommands!);
      const createCmd = await resolveCommand(profileSubCommands.create);
      const args = await resolveArgs(createCmd.args!);

      expect(args).toBeDefined();
      // Check all args have descriptions
      expect(args.name.description).toBeDefined();
      expect(args.user.description).toBeDefined();
      expect(args["workspace-id"].description).toBeDefined();
    });
  });

  describe("common args presence", () => {
    it("apply command includes common args", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const applyCmd = await resolveCommand(subCommands.apply);
      const args = await resolveArgs(applyCmd.args!);

      expect(args).toBeDefined();
      // Common args from commonArgs
      expect(args["env-file"]).toBeDefined();
      expect(args["env-file-if-exists"]).toBeDefined();
      expect(args.verbose).toBeDefined();
    });

    it("generate command includes common args", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const generateCmd = await resolveCommand(subCommands.generate);
      const args = await resolveArgs(generateCmd.args!);

      expect(args).toBeDefined();
      expect(args.verbose).toBeDefined();
    });
  });

  describe("aliases defined", () => {
    it("apply command config has alias", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const applyCmd = await resolveCommand(subCommands.apply);
      const args = await resolveArgs(applyCmd.args!);

      expect("alias" in args.config && args.config.alias).toBe("c");
    });

    it("profile create user has alias", async () => {
      const { mainCommand } = await import("../index");

      const subCommands = await resolveSubCommands(mainCommand.subCommands!);
      const profileCmd = await resolveCommand(subCommands.profile);
      const profileSubCommands = await resolveSubCommands(profileCmd.subCommands!);
      const createCmd = await resolveCommand(profileSubCommands.create);
      const args = await resolveArgs(createCmd.args!);

      expect("alias" in args.user && args.user.alias).toBe("u");
      expect("alias" in args["workspace-id"] && args["workspace-id"].alias).toBe("w");
    });
  });
});
