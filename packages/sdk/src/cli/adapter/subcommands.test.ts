/**
 * Subcommand parsing tests
 *
 * NOTE: Process-based tests for subcommand and help output verification
 * are currently skipped in vitest due to environment limitations.
 * These tests can be run separately with a dedicated test runner.
 *
 * For now, we verify that the command structure exists and args are properly
 * passed through citty's subcommand system.
 */

import { describe, it, expect, vi } from "vitest";
import type { CommandDef, Resolvable, SubCommandsDef, ArgsDef } from "citty";

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

describe("subcommand structure", () => {
  it("main command has expected subcommands", { timeout: 10000 }, async () => {
    // Import after mocks are set up
    const { mainCommand } = await import("../index");

    expect(mainCommand.subCommands).toBeDefined();

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    expect(subCommands.profile).toBeDefined();
    expect(subCommands.secret).toBeDefined();
    expect(subCommands.apply).toBeDefined();
    expect(subCommands.generate).toBeDefined();
    expect(subCommands.login).toBeDefined();
    expect(subCommands.logout).toBeDefined();
    expect(subCommands.show).toBeDefined();
    expect(subCommands.workflow).toBeDefined();
    expect(subCommands.workspace).toBeDefined();
  });

  it("profile command has expected subcommands", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const profileCmd = await resolveCommand(subCommands.profile);
    const profileSubCommands = await resolveSubCommands(profileCmd.subCommands!);

    expect(profileSubCommands.create).toBeDefined();
    expect(profileSubCommands.delete).toBeDefined();
    expect(profileSubCommands.list).toBeDefined();
    expect(profileSubCommands.update).toBeDefined();
  });

  it("secret command has vault subcommand", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const secretCmd = await resolveCommand(subCommands.secret);
    const secretSubCommands = await resolveSubCommands(secretCmd.subCommands!);

    expect(secretSubCommands.vault).toBeDefined();
    expect(secretSubCommands.create).toBeDefined();
    expect(secretSubCommands.delete).toBeDefined();
    expect(secretSubCommands.list).toBeDefined();
  });

  it("vault command has expected subcommands (nested)", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const secretCmd = await resolveCommand(subCommands.secret);
    const secretSubCommands = await resolveSubCommands(secretCmd.subCommands!);
    const vaultCmd = await resolveCommand(secretSubCommands.vault);
    const vaultSubCommands = await resolveSubCommands(vaultCmd.subCommands!);

    expect(vaultSubCommands.create).toBeDefined();
    expect(vaultSubCommands.delete).toBeDefined();
    expect(vaultSubCommands.list).toBeDefined();
  });
});

// Helper to resolve args
async function resolveArgs(args: Resolvable<ArgsDef>): Promise<ArgsDef> {
  if (typeof args === "function") {
    return await args();
  }
  return await args;
}

describe("command args structure", () => {
  it("apply command has deploymentArgs", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const applyCmd = await resolveCommand(subCommands.apply);
    const args = await resolveArgs(applyCmd.args!);

    expect(args).toBeDefined();
    // deploymentArgs includes config
    expect(args.config).toBeDefined();
    expect(args.config.type).toBe("string");
    expect("alias" in args.config && args.config.alias).toBe("c");
    expect("default" in args.config && args.config.default).toBe("tailor.config.ts");
    // deploymentArgs includes workspaceArgs
    expect(args["workspace-id"]).toBeDefined();
    expect(args.profile).toBeDefined();
  });

  it("generate command has config and watch args", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const generateCmd = await resolveCommand(subCommands.generate);
    const args = await resolveArgs(generateCmd.args!);

    expect(args).toBeDefined();
    expect(args.config).toBeDefined();
    expect(args.config.type).toBe("string");
    expect("alias" in args.config && args.config.alias).toBe("c");
    expect(args.watch).toBeDefined();
    expect(args.watch.type).toBe("boolean");
  });

  it("profile create command has required args", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = await resolveSubCommands(mainCommand.subCommands!);
    const profileCmd = await resolveCommand(subCommands.profile);
    const profileSubCommands = await resolveSubCommands(profileCmd.subCommands!);
    const createCmd = await resolveCommand(profileSubCommands.create);
    const args = await resolveArgs(createCmd.args!);

    expect(args).toBeDefined();
    // positional name arg
    expect(args.name).toBeDefined();
    expect(args.name.type).toBe("positional");
    expect(args.name.required).toBe(true);
    // required user arg
    expect(args.user).toBeDefined();
    expect(args.user.type).toBe("string");
    expect(args.user.required).toBe(true);
    // required workspace-id arg
    expect(args["workspace-id"]).toBeDefined();
    expect(args["workspace-id"].type).toBe("string");
    expect(args["workspace-id"].required).toBe(true);
  });
});
