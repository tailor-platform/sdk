import { extractFields } from "politty";
import { describe, it, expect, vi } from "vitest";
import { mainCommand } from "./index";
import type { AnyCommand, ExtractedFields } from "politty";

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

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

// The CLI option test only needs the command shape; arg typing is irrelevant here.
// oxlint-disable-next-line no-explicit-any
async function resolveCommand<T extends AnyCommand>(cmd: Resolvable<T>): Promise<T> {
  if (typeof cmd === "function") {
    return await cmd();
  }
  return await cmd;
}

/**
 * Check for duplicate short option aliases in a command's args
 * @param extracted - Extracted fields from command args
 * @param path - Command path for error messages
 */
function checkArgs(extracted: ExtractedFields, path: string[]): void {
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
}

// The CLI option test only needs the command shape; arg typing is irrelevant here.
// oxlint-disable-next-line no-explicit-any
async function walkCommand<T extends AnyCommand>(
  cmd: Resolvable<T>,
  path: string[] = [],
): Promise<void> {
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
  it("does not have duplicate short option aliases in any command", async () => {
    const subCommands = mainCommand.subCommands;
    expect(subCommands).toBeDefined();

    for (const [name, cmd] of Object.entries(mainCommand.subCommands ?? {})) {
      await walkCommand(cmd, [name]);
    }
  });
});
