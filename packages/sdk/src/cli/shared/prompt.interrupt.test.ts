import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import { tsHookPreamble } from "#/cli/shared/test-helpers/ts-hook-child";

const ptyScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-helpers/pty-session.py",
);
const hasPython = process.platform !== "win32" && spawnSync("python3", ["-V"]).status === 0;

function runPromptInPty(body: string, keys: string) {
  const entry = `${tsHookPreamble()}
    const { prompt } = await import("#/cli/shared/prompt");
    ${body}
  `;
  const result = spawnSync(
    "python3",
    [
      "-I",
      ptyScript,
      "PROMPT>",
      Buffer.from(keys).toString("hex"),
      "30",
      process.execPath,
      "--input-type=module",
      "-e",
      entry,
    ],
    { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );
  const [exitCode, ...rest] = result.stdout.split("\n");
  return { exitCode: Number(exitCode), output: stripAnsi(rest.join("\n")) };
}

describe.skipIf(!hasPython)("prompt interrupted in a real terminal", () => {
  test.each(["password", "text", "confirm"] as const)(
    "Ctrl-C at the %s prompt exits with 130 and prints no error",
    (kind) => {
      const { exitCode, output } = runPromptInPty(
        `await prompt.${kind}({ message: "PROMPT>" });`,
        "\x03",
      );

      expect(output).not.toContain("SIGINT");
      expect(output).not.toContain("force closed");
      expect(exitCode).toBe(130);
    },
    60_000,
  );
});
