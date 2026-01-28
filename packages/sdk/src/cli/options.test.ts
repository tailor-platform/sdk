import { describe, it, expect, vi } from "vitest";
import { mainCommand } from "./index";
import type { AnyCommand } from "politty";

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

// The CLI option test only needs the command shape; arg typing is irrelevant here.
// oxlint-disable-next-line no-explicit-any
async function walkCommand<T extends AnyCommand>(cmd: Resolvable<T>, path: string[] = []) {
  const resolved = await resolveCommand(cmd);
  // politty validates args via Zod schemas internally

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
