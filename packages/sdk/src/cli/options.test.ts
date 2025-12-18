import { describe, it, expect } from "vitest";
import { mainCommand } from "./main-command";
import type { CommandDef } from "citty";

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveCommand(
  cmd: Resolvable<CommandDef<any>>,
): Promise<CommandDef<any>> {
  if (typeof cmd === "function") {
    return await cmd();
  }
  return await cmd;
}

type ArgDef = {
  alias?: string | string[];
  [key: string]: unknown;
};

type CommandArgs = Record<string, ArgDef>;

const checkArgs = (args: CommandArgs, path: string[]) => {
  const seen = new Map<string, string>();

  for (const [name, def] of Object.entries(args)) {
    const aliases = Array.isArray(def.alias)
      ? def.alias
      : def.alias
        ? [def.alias]
        : [];
    for (const alias of aliases) {
      const prev = seen.get(alias);
      if (prev) {
        throw new Error(
          `Command "${path.join(" ")}": alias "-${alias}" is duplicated between args "${prev}" and "${name}"`,
        );
      }
      seen.set(alias, name);
    }
  }
};

async function walkCommand(
  cmd: Resolvable<CommandDef<any>>,
  path: string[] = [],
) {
  const resolved = await resolveCommand(cmd);
  if (resolved.args) {
    checkArgs(resolved.args, path);
  }

  if (resolved.subCommands) {
    for (const [name, sub] of Object.entries(resolved.subCommands)) {
      await walkCommand(sub, [...path, name]);
    }
  }
}

describe("CLI options", () => {
  it("does not have duplicate short option aliases in any command", async () => {
    const subCommands = mainCommand.subCommands;
    expect(subCommands).toBeDefined();

    for (const [name, cmd] of Object.entries(mainCommand.subCommands ?? {})) {
      await walkCommand(cmd, [name]);
    }
  });
});
