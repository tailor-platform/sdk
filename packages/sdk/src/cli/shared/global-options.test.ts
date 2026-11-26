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
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { commonArgs, createCommonArgs } from "./args";
import { defineAppCommand } from "./command";

const fields = extractFields(z.strictObject(commonArgs)).fields;
const valueFields = fields.filter((field) => field.type !== "boolean");
const booleanFields = fields.filter((field) => field.type === "boolean");

describe("the global options the codemods look for", () => {
  test("name every value-taking global option of the CLI", () => {
    expect(valueFields.map((field) => field.cliName).toSorted()).toEqual(
      GLOBAL_VALUE_OPTIONS.map((option) => option.name).toSorted(),
    );
  });

  test("name every global flag of the CLI", () => {
    expect(booleanFields.map((field) => field.cliName).toSorted()).toEqual(
      GLOBAL_BOOLEAN_OPTIONS.map((option) => option.name).toSorted(),
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

  async function run(argv: string[]) {
    const messages: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      messages.push(String(chunk));
      return true;
    });
    try {
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, argv, {
        globalArgs: z.strictObject(createCommonArgs()),
      });
      return { exitCode: result.exitCode, output: messages.join("") };
    } finally {
      warn.mockRestore();
      write.mockRestore();
    }
  }

  test.each([["--noBogus"], ["--no-env-file"], ["--bogus"]])(
    "warns about %s, which is not a global flag",
    async (flag) => {
      expect((await run([flag])).output).toContain("Unexpected");
    },
  );

  test.each(GLOBAL_BOOLEAN_FLAGS.map((flag) => [flag]))("is read as the flag %s", async (flag) => {
    const { exitCode, output } = await run([flag]);

    expect(exitCode).toBe(0);
    expect(output).not.toContain("Unexpected");
  });

  test.each(GLOBAL_VALUE_FLAGS.map((flag) => [flag]))(
    "is read as the option %s given a value",
    async (flag) => {
      delete process.env.GLOBAL_OPTIONS_PROBE;
      const argv = flag.includes("=") ? [flag] : [flag, envFile];
      const { exitCode, output } = await run(argv);

      expect(exitCode).toBe(0);
      expect(output).not.toContain("Unexpected");
      expect(process.env.GLOBAL_OPTIONS_PROBE).toBe("1");
    },
  );
});
