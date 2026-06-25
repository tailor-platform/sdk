import { extractFields, isLazyCommand } from "politty";
import { describe, expect, test, vi } from "vitest";
import { BUILTIN_COMMAND_NAMES } from "./shared/builtin-commands";
import { mainCommand } from "./index";
import type { AnyCommand, ExtractedFields, SubCommandValue } from "politty";

vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return {
    ...actual,
    register: vi.fn(),
  };
});

vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return {
    ...actual,
    runMain: vi.fn(),
  };
});

async function resolveCommand(cmd: SubCommandValue): Promise<AnyCommand> {
  if (isLazyCommand(cmd)) {
    return await cmd.load();
  }
  if (typeof cmd === "function") {
    return await cmd();
  }
  return cmd;
}

const checkArgs = (extracted: ExtractedFields, path: string[]): void => {
  const seen = new Map<string, string>();

  for (const field of extracted.fields) {
    if (field.alias) {
      const aliases = Array.isArray(field.alias) ? field.alias : [field.alias];
      for (const alias of aliases) {
        const prev = seen.get(alias);
        if (prev) {
          throw new Error(
            `Command "${path.join(" ")}": alias "-${alias}" is duplicated between args "${prev}" and "${field.name}"`,
          );
        }
        seen.set(alias, field.name);
      }
    }
  }
};

async function walkCommand(cmd: SubCommandValue, path: string[] = []): Promise<void> {
  const resolved = await resolveCommand(cmd);

  // Check for duplicate aliases if the command has args
  if (resolved.args) {
    const extracted = extractFields(resolved.args);
    checkArgs(extracted, path);
  }

  if (resolved.subCommands) {
    for (const [name, sub] of Object.entries(resolved.subCommands)) {
      await walkCommand(sub, [...path, name]);
    }
  }
}

describe("CLI options", () => {
  test("does not have duplicate short option aliases in any command", async () => {
    const subCommands = mainCommand.subCommands;
    expect(subCommands).toBeDefined();

    for (const [name, cmd] of Object.entries(mainCommand.subCommands ?? {})) {
      await walkCommand(cmd, [name]);
    }
  });

  test("keeps BUILTIN_COMMAND_NAMES in sync with the registered subcommands", () => {
    // `plugin list` uses BUILTIN_COMMAND_NAMES (a leaf module, to avoid an
    // import cycle) to flag shadowed plugins. Exclude the wrapper-added
    // `completion` command and any internal `__`-prefixed commands.
    const registered = Object.keys(mainCommand.subCommands ?? {}).filter(
      (name) => !name.startsWith("__") && name !== "completion",
    );
    expect(new Set(registered)).toEqual(new Set(BUILTIN_COMMAND_NAMES));
  });
});
