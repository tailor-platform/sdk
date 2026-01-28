/**
 * Subcommand parsing tests
 *
 * NOTE: Process-based tests for subcommand and help output verification
 * are currently skipped in vitest due to environment limitations.
 * These tests can be run separately with a dedicated test runner.
 *
 * For now, we verify that the command structure exists and args are properly
 * configured through politty's subcommand system.
 */

import { describe, it, expect, vi } from "vitest";
import type { AnyCommand } from "politty";

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

describe("subcommand structure", () => {
  it("main command has expected subcommands", { timeout: 10000 }, async () => {
    // Import after mocks are set up
    const { mainCommand } = await import("../index");

    expect(mainCommand.subCommands).toBeDefined();

    const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
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

    const subCommands = mainCommand.subCommands as Record<string, CommandWithSubCommands>;
    const profileCmd = subCommands.profile;
    const profileSubCommands = profileCmd.subCommands as Record<string, AnyCommand>;

    expect(profileSubCommands.create).toBeDefined();
    expect(profileSubCommands.delete).toBeDefined();
    expect(profileSubCommands.list).toBeDefined();
    expect(profileSubCommands.update).toBeDefined();
  });

  it("secret command has vault subcommand", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = mainCommand.subCommands as Record<string, CommandWithSubCommands>;
    const secretCmd = subCommands.secret;
    const secretSubCommands = secretCmd.subCommands as Record<string, AnyCommand>;

    expect(secretSubCommands.vault).toBeDefined();
    expect(secretSubCommands.create).toBeDefined();
    expect(secretSubCommands.delete).toBeDefined();
    expect(secretSubCommands.list).toBeDefined();
  });

  it("vault command has expected subcommands (nested)", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = mainCommand.subCommands as Record<string, CommandWithSubCommands>;
    const secretCmd = subCommands.secret;
    const secretSubCommands = secretCmd.subCommands as Record<string, CommandWithSubCommands>;
    const vaultCmd = secretSubCommands.vault;
    const vaultSubCommands = vaultCmd.subCommands as Record<string, AnyCommand>;

    expect(vaultSubCommands.create).toBeDefined();
    expect(vaultSubCommands.delete).toBeDefined();
    expect(vaultSubCommands.list).toBeDefined();
  });
});

describe("command args structure", () => {
  it("apply command has args schema defined", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
    const applyCmd = subCommands.apply;

    // In politty, args is a Zod schema
    expect(applyCmd.args).toBeDefined();
  });

  it("generate command has args schema defined", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = mainCommand.subCommands as Record<string, AnyCommand>;
    const generateCmd = subCommands.generate;

    expect(generateCmd.args).toBeDefined();
  });

  it("profile create command has args schema defined", async () => {
    const { mainCommand } = await import("../index");

    const subCommands = mainCommand.subCommands as Record<string, CommandWithSubCommands>;
    const profileCmd = subCommands.profile;
    const profileSubCommands = profileCmd.subCommands as Record<string, AnyCommand>;
    const createCmd = profileSubCommands.create;

    expect(createCmd.args).toBeDefined();
  });
});
