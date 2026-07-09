import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "pathe";
import { extractFields, isLazyCommand, runCommand } from "politty";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { commonArgs } from "./shared/args";
import { logger } from "./shared/logger";
import { tempCwd } from "./shared/test-helpers/temp-cwd";
import { mainCommand } from "./index";
import type { AnyCommand, RunResult, SubCommandValue } from "politty";

vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return { ...actual, register: vi.fn() };
});

vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return { ...actual, runMain: vi.fn() };
});

// strip unknown global args to match the CLI runner.
const testGlobalArgs = z.object(commonArgs);

async function resolveCommand(cmd: SubCommandValue): Promise<AnyCommand> {
  if (isLazyCommand(cmd)) {
    return await cmd.load();
  }
  if (typeof cmd === "function") {
    return await cmd();
  }
  return cmd;
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

function expectCommandFailure(result: RunResult, message: string): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected command to fail");
  }
  expect(result.error.message).toContain(message);
}

async function importMainCommandForCurrentCwd(): Promise<AnyCommand> {
  vi.resetModules();
  const module = await import("./index");
  return module.mainCommand;
}

describe("skills command", () => {
  test("uses politty skill management subcommands without legacy aliases", async () => {
    const skillsCommand = await resolveCommand(expectDefined(mainCommand.subCommands.skills));
    const skillSubCommands = expectDefined(skillsCommand.subCommands);
    const addCommand = await resolveCommand(expectDefined(skillSubCommands.add));
    const removeCommand = await resolveCommand(expectDefined(skillSubCommands.remove));

    expect(Object.keys(skillSubCommands).toSorted()).toEqual(["add", "list", "remove", "sync"]);
    expect(skillsCommand.run).toBeTypeOf("function");
    expect(addCommand.aliases).toBeUndefined();
    expect(removeCommand.aliases).toBeUndefined();
    expect(
      extractFields(expectDefined(addCommand.args)).fields.map((field) => field.name),
    ).not.toEqual(expect.arrayContaining(["agent", "yes"]));
  });

  test("does not shadow inherited global flags with local defaults", async () => {
    const skillsCommand = await resolveCommand(expectDefined(mainCommand.subCommands.skills));
    const skillSubCommands = expectDefined(skillsCommand.subCommands);
    const addCommand = await resolveCommand(expectDefined(skillSubCommands.add));
    const listCommand = await resolveCommand(expectDefined(skillSubCommands.list));

    expect(expectDefined(addCommand.args).parse({})).not.toHaveProperty("verbose");
    expect(expectDefined(listCommand.args).parse({})).not.toHaveProperty("json");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runCommand(mainCommand, ["--json", "skills", "list"], {
        globalArgs: testGlobalArgs,
        captureLogs: true,
      });

      expect(result.success).toBe(true);
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"name":"tailor"'));
    } finally {
      consoleLog.mockRestore();
      logger.jsonMode = false;
    }
  });

  test("rejects removed legacy forms before side effects", async () => {
    using tmp = tempCwd("tailor-skills-command-");
    writeFileSync(join(tmp.dir, "package.json"), "{}\n");
    const cwdMainCommand = await importMainCommandForCurrentCwd();

    const installResult = await runCommand(cwdMainCommand, ["skills", "install"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expectCommandFailure(installResult, "Unknown subcommand");
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(false);

    const agentResult = await runCommand(cwdMainCommand, ["skills", "add", "--agent", "codex"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expectCommandFailure(agentResult, "Unknown flags: agent");
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(false);
  });

  test("rejects unknown skill flags before side effects", async () => {
    using tmp = tempCwd("tailor-skills-command-");
    writeFileSync(join(tmp.dir, "package.json"), "{}\n");
    const cwdMainCommand = await importMainCommandForCurrentCwd();

    const addResult = await runCommand(cwdMainCommand, ["skills", "add", "--agnt", "codex"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });

    expectCommandFailure(addResult, "Unknown flags: agnt");
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(false);

    const installResult = await runCommand(cwdMainCommand, ["skills", "add"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expect(installResult.success).toBe(true);

    const removeResult = await runCommand(cwdMainCommand, ["skills", "remove", "--nam", "nope"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expectCommandFailure(removeResult, "Unknown flags: nam");
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(true);

    const syncResult = await runCommand(cwdMainCommand, ["skills", "sync", "--exlude", "tailor"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expectCommandFailure(syncResult, "Unknown flags: exlude");
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(true);
  });

  test("propagates default install failures from the skills command", async () => {
    using tmp = tempCwd("tailor-skills-command-");
    writeFileSync(join(tmp.dir, "package.json"), "{}\n");
    const cwdMainCommand = await importMainCommandForCurrentCwd();
    mkdirSync(join(tmp.dir, ".agents/skills/tailor"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".agents/skills/tailor/SKILL.md"),
      "---\nname: tailor\ndescription: manual\n---\n# Manual\n",
    );

    const result = await runCommand(cwdMainCommand, ["skills"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });

    expect(result.success).toBe(false);
    expectCommandFailure(result, 'Refusing to install "tailor"');
  });

  test("removes installed Tailor skills", async () => {
    using tmp = tempCwd("tailor-skills-command-");
    writeFileSync(join(tmp.dir, "package.json"), "{}\n");
    const cwdMainCommand = await importMainCommandForCurrentCwd();

    const addResult = await runCommand(cwdMainCommand, ["skills", "add"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expect(addResult.success).toBe(true);
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor/SKILL.md"))).toBe(true);

    const removeResult = await runCommand(cwdMainCommand, ["skills", "remove"], {
      globalArgs: testGlobalArgs,
      captureLogs: true,
    });
    expect(removeResult.success).toBe(true);
    expect(existsSync(join(tmp.dir, ".agents/skills/tailor"))).toBe(false);
  });
});
