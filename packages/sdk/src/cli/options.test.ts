import { isDeepStrictEqual } from "node:util";
import { extractFields, isLazyCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { mainCommand } from "./main";
import { commonArgs, configArg, folderArgs, organizationArgs, workspaceArgs } from "./shared/args";
import { BUILTIN_COMMAND_NAMES } from "./shared/builtin-commands";
import type { AnyCommand, ExtractedFields, SubCommandValue } from "@politty/zod";

const allowedHybridCommandPaths = new Set(["api"]);

const allowedOptionsWithoutSharedEnv = new Set([
  "profile create --workspace-id",
  "profile update --workspace-id",
  "workspace delete --workspace-id",
  "workspace restore --workspace-id",
  "workspace prune --folder-id",
]);

const collectFields = (extracted: ExtractedFields): ExtractedFields["fields"] => [
  ...extracted.fields,
  ...(extracted.variants ?? []).flatMap((variant) => variant.fields),
  ...(extracted.unionOptions ?? []).flatMap(collectFields),
];

const sharedOptionEnvs = new Map(
  extractFields(
    z.strictObject({
      ...commonArgs,
      ...workspaceArgs,
      ...configArg,
      ...organizationArgs,
      ...folderArgs,
    }),
  )
    .fields.filter((field) => field.env !== undefined)
    .map((field) => [field.cliName, field.env]),
);

vi.mock("@politty/zod", async () => {
  const actual = await vi.importActual("@politty/zod");
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

const checkNoHybridPositionalCommand = (command: AnyCommand, path: string[]): void => {
  if (!command.subCommands || !command.run || !command.args) return;

  const extracted = extractFields(command.args);
  const positionalFields = extracted.fields.filter((field) => field.positional);
  if (positionalFields.length === 0) return;

  const commandPath = path.join(" ");
  if (allowedHybridCommandPaths.has(commandPath)) return;

  throw new Error(
    `Command "${commandPath}": commands with subcommands must not also define positional args (${positionalFields.map((field) => field.name).join(", ")}) and a run handler`,
  );
};

async function walkCommand(
  cmd: SubCommandValue,
  visit: (command: AnyCommand, path: string[]) => void,
  path: string[] = [],
): Promise<void> {
  const resolved = await resolveCommand(cmd);

  visit(resolved, path);

  if (resolved.subCommands) {
    for (const [name, sub] of Object.entries(resolved.subCommands)) {
      await walkCommand(sub, visit, [...path, name]);
    }
  }
}

async function walkMainCommands(visit: (command: AnyCommand, path: string[]) => void) {
  const subCommands = mainCommand.subCommands;
  expect(subCommands).toBeDefined();

  for (const [name, cmd] of Object.entries(subCommands)) {
    await walkCommand(cmd, visit, [name]);
  }
}

describe("CLI options", () => {
  test("does not have duplicate short option aliases in any command", async () => {
    let checked = 0;

    await walkMainCommands((command, path) => {
      if (!command.args) return;

      checked += 1;
      checkArgs(extractFields(command.args), path);
    });

    expect(checked).toBeGreaterThan(0);
  });

  test("does not define hybrid commands with positional args", async () => {
    let checked = 0;

    await walkMainCommands((command, path) => {
      checked += 1;
      checkNoHybridPositionalCommand(command, path);
    });

    expect(checked).toBeGreaterThan(0);
  });

  test("keeps BUILTIN_COMMAND_NAMES in sync with the registered subcommands", () => {
    // `plugin list` uses BUILTIN_COMMAND_NAMES (a leaf module, to avoid an
    // import cycle) to flag shadowed plugins. Exclude the wrapper-added
    // `completion` command and any internal `__`-prefixed commands.
    const registered = Object.keys(mainCommand.subCommands).filter(
      (name) => !name.startsWith("__") && name !== "completion",
    );
    expect(new Set(registered)).toEqual(new Set(BUILTIN_COMMAND_NAMES));
  });

  test("declares the shared environment variable on shared options outside the allowed exceptions", async () => {
    const mismatches = new Set<string>();
    const unusedExceptions = new Set(allowedOptionsWithoutSharedEnv);
    let checked = 0;

    await walkMainCommands((command, path) => {
      if (!command.args) return;

      for (const field of collectFields(extractFields(command.args))) {
        if (!sharedOptionEnvs.has(field.cliName)) continue;
        checked += 1;
        const option = `${path.join(" ")} --${field.cliName}`;
        if (isDeepStrictEqual(field.env, sharedOptionEnvs.get(field.cliName))) continue;
        if (allowedOptionsWithoutSharedEnv.has(option)) {
          unusedExceptions.delete(option);
          continue;
        }
        mismatches.add(`${option}: ${JSON.stringify(field.env)}`);
      }
    });

    expect(checked).toBeGreaterThan(0);
    expect([...mismatches]).toEqual([]);
    expect([...unusedExceptions]).toEqual([]);
  });
});
