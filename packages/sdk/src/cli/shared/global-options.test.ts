import * as fs from "node:fs";
import * as os from "node:os";
import { extractFields, runCommand } from "@politty/zod";
import {
  GLOBAL_BOOLEAN_FLAGS,
  GLOBAL_BOOLEAN_OPTIONS,
  GLOBAL_VALUE_FLAGS,
  GLOBAL_VALUE_OPTIONS,
} from "@tailor-platform/shared/global-options";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { commonArgs, createCommonArgs, flagTokensOf } from "./args";
import { defineAppCommand } from "./command";

const fields = extractFields(z.strictObject(commonArgs)).fields;
const valueFields = fields.filter((field) => field.type !== "boolean");
const booleanFields = fields.filter((field) => field.type === "boolean");

const isNegated = (flag: string) => /^--no(?:-|[A-Z])/.test(flag);

describe("the global options the codemods look for", () => {
  test("name every value-taking global option of the CLI, with every spelling", () => {
    expect(valueFields.flatMap(flagTokensOf).toSorted()).toEqual(
      [...GLOBAL_VALUE_FLAGS].toSorted(),
    );
  });

  test("name every global flag of the CLI, with every spelling but the negated ones", () => {
    expect([...new Set(booleanFields.flatMap(flagTokensOf))].toSorted()).toEqual(
      GLOBAL_BOOLEAN_FLAGS.filter((flag) => !isNegated(flag)).toSorted(),
    );
  });

  test("give each option the short alias the CLI gives it", () => {
    const aliasesOf = (list: typeof fields) =>
      list.flatMap((field) => field.alias ?? []).toSorted();

    expect(aliasesOf(valueFields)).toEqual(
      GLOBAL_VALUE_OPTIONS.flatMap((option) => option.alias ?? []).toSorted(),
    );
    expect(aliasesOf(booleanFields)).toEqual(
      GLOBAL_BOOLEAN_OPTIONS.flatMap((option) => option.alias ?? []).toSorted(),
    );
  });
});

describe("a command line spelled with the global options", () => {
  let envFile: string;

  beforeAll(() => {
    envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "global-options-")), ".env");
    fs.writeFileSync(envFile, "GLOBAL_OPTIONS_PROBE=1\n");
  });

  afterAll(() => {
    fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  });

  async function exitCodeOf(argv: string[]): Promise<number> {
    const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
    const result = await runCommand(command, argv, {
      globalArgs: z.strictObject(createCommonArgs()),
    });
    return result.exitCode;
  }

  test.each(GLOBAL_BOOLEAN_FLAGS.map((flag) => [flag]))(
    "is accepted for the flag %s",
    async (flag) => {
      expect(await exitCodeOf([flag])).toBe(0);
    },
  );

  test.each(GLOBAL_VALUE_FLAGS.map((flag) => [flag]))(
    "is accepted for the option %s given a value",
    async (flag) => {
      expect(await exitCodeOf([flag, envFile])).toBe(0);
    },
  );
});
