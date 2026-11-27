import { globSync, readFileSync } from "node:fs";
import {
  defineCommand,
  isLazyCommand,
  lazy,
  type AnyCommand,
  type SubCommandValue,
} from "@politty/zod";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { mainCommand } from "./main";

const { runMain } = vi.hoisted(() => ({ runMain: vi.fn<(command: AnyCommand) => void>() }));

vi.mock("@politty/zod", async () => ({
  ...(await vi.importActual("@politty/zod")),
  runMain,
}));

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

const PLUGIN_ENTRIES = [
  "sdk-plugin-setup/src/cli.ts",
  "sdk-plugin-seed/src/index.ts",
  "sdk-plugin-tailordb-erd/src/cli.ts",
  "sdk-plugin-function-ui/src/cli.ts",
  "sdk-plugin-studio/src/cli.ts",
];

for (const entry of PLUGIN_ENTRIES) {
  // A URL import keeps the plugin sources out of this package's type-check program.
  await import(/* @vite-ignore */ new URL(`../../../${entry}`, import.meta.url).href);
}

const pluginCommands = new Map<string, AnyCommand>();
for (const [command] of runMain.mock.calls) {
  if (command.name.startsWith("tailor-")) {
    pluginCommands.set(command.name.slice("tailor-".length), command);
  }
}

const MENTION_FILES = [
  "packages/*/src/**/*.{ts,mts,yml}",
  "packages/sdk-codemod/codemods/**/*.ts",
  "packages/sdk-codemod/codemods/**/tests/**/expected.*",
  "packages/*/docs/**/*.md",
  "packages/*/README.md",
  "packages/*/package.json",
  "packages/sdk/agent-skills/**/*.md",
  "packages/create-sdk/templates/*/{README.md,package.json,tailor.d.ts}",
  "example/package.json",
];

// Codemod inputs hold the old names their codemods rewrite.
const EXCLUDED_FILES =
  /\.test(?:-d)?\.ts$|\/(?:__test_fixtures__|fixtures|test-helpers)\/|\/codemods\/.*\/tests\/.*\binput\./;

// The docs name this third-party plugin to show how `tailor <name>` dispatches to a plugin.
const EXAMPLE_PLUGINS = new Set(["hello"]);

type Mention = { line: number; words: string[] };

const CLI = String.raw`(?:(?:npx |pnpm (?:exec )?)?tailor|npx @tailor-platform\/sdk(?:@[\w.^~-]+)?)`;
const WORDS = String.raw`((?: [a-z][a-z0-9-]*)+)(?=[\s\x60'"\\<$|;)\]]|$)`;
const INLINE_COMMAND = new RegExp(
  String.raw`(?:[\x60'"]|\\n)[ \t]*${CLI}${WORDS}|__TAILOR_CLI__${WORDS}`,
  "g",
);
const CHAINED_COMMAND = new RegExp(String.raw`(?:&& |\| |\$\()${CLI}${WORDS}`, "g");
const SHELL_BLOCK = /^([ \t]*(?:>[ \t]*)?)```(?:sh|bash|shell|console|zsh)\r?\n([\s\S]*?)^\1```/gm;
const SHELL_LINE = new RegExp(String.raw`^[ \t>]*(?:\$ )?${CLI}${WORDS}`, "gm");

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function matchMentions(text: string, pattern: RegExp, lineOffset = 0): Mention[] {
  return [...text.matchAll(pattern)].map((match) => ({
    line: lineOffset + lineAt(text, match.index),
    words: (match[1] ?? match[2])!.trim().split(" "),
  }));
}

/**
 * The `tailor` commands a file names: after a quote, a backtick, or an escaped newline; as the
 * generated workflows' CLI placeholder; after `&&`, `|`, or `$(`; or at the start of a line in a
 * shell code block.
 * @param file - Repository-relative path of the file
 * @param text - Its contents
 * @returns Each command's line and words, without options and placeholders
 */
function mentionsIn(file: string, text: string): Mention[] {
  const mentions = [
    ...matchMentions(text, INLINE_COMMAND),
    ...matchMentions(text, CHAINED_COMMAND),
  ];
  if (file.endsWith(".md")) {
    for (const block of text.matchAll(SHELL_BLOCK)) {
      const body = block[2]!;
      const linesBeforeBody = lineAt(text, block.index + block[0].indexOf("\n") + 1) - 1;
      mentions.push(...matchMentions(body, SHELL_LINE, linesBeforeBody));
    }
  }
  return mentions.toSorted((a, b) => a.line - b.line);
}

async function loadCommand(value: SubCommandValue): Promise<AnyCommand> {
  if (isLazyCommand(value)) return value.load();
  return typeof value === "function" ? value() : value;
}

async function findSubCommand(command: AnyCommand, word: string): Promise<AnyCommand | undefined> {
  const subCommands = Object.entries(command.subCommands ?? {});
  const named = subCommands.find(([name]) => name === word);
  if (named) return loadCommand(named[1]);
  for (const [, value] of subCommands) {
    const subCommand = await loadCommand(value);
    if (subCommand.aliases?.includes(word)) return subCommand;
  }
  return undefined;
}

/**
 * Walk `tailor <words>` down the command tree, into a CLI plugin where the CLI would dispatch to one.
 * @param root - The `tailor` command
 * @param plugins - Plugin root commands by the slug the CLI dispatches to (`tailordb-erd` for `tailor tailordb erd`)
 * @param words - The words after `tailor`
 * @returns Why the words name no command, or undefined when they do
 */
async function unknownCommandReason(
  root: AnyCommand,
  plugins: ReadonlyMap<string, AnyCommand>,
  words: readonly string[],
): Promise<string | undefined> {
  let command = root;
  const commandPath: string[] = [];
  for (const word of words) {
    if (Object.keys(command.subCommands ?? {}).length === 0) return undefined;
    const next =
      (await findSubCommand(command, word)) ?? plugins.get([...commandPath, word].join("-"));
    if (!next) return `no "${word}" under "${["tailor", ...commandPath].join(" ")}"`;
    command = next;
    commandPath.push(word);
  }
  return undefined;
}

test("every tailor command that the sources and docs name exists", async () => {
  const matches = MENTION_FILES.map((pattern) =>
    globSync(pattern, { cwd: repoRoot }).map((file) => path.normalize(file)),
  );
  expect(MENTION_FILES.filter((_, index) => matches[index]!.length === 0)).toEqual([]);
  const files = matches.flat().filter((file) => !EXCLUDED_FILES.test(file));

  const unknown: string[] = [];
  for (const file of new Set(files)) {
    for (const { line, words } of mentionsIn(
      file,
      readFileSync(path.join(repoRoot, file), "utf8"),
    )) {
      if (EXAMPLE_PLUGINS.has(words[0]!)) continue;
      const reason = await unknownCommandReason(mainCommand, pluginCommands, words);
      if (reason) unknown.push(`${file}:${line}: tailor ${words.join(" ")}: ${reason}`);
    }
  }

  expect(unknown).toEqual([]);
});

describe("mentionsIn", () => {
  test.each([
    ["a backtick", "Run `tailor deploy --dry-run` first.", ["deploy"]],
    [
      "an escaped backtick in a template literal",
      "Run \\`tailor setup ci ${kind}\\` again.",
      ["setup", "ci"],
    ],
    ["a single quote", "Run 'tailor generate' to refresh.", ["generate"]],
    [
      "a package runner",
      "Run `pnpm exec tailor tailordb migration generate`.",
      ["tailordb", "migration", "generate"],
    ],
    ["the workflow CLI placeholder", "  run: __TAILOR_CLI__ seed validate", ["seed", "validate"]],
    ["a double quote", 'The "tailor deploy" step.', ["deploy"]],
    ["a quote and indentation", '"   tailor setup ci env --check  # then"', ["setup", "ci", "env"]],
    ["an escaped newline", "`Then run:\\n  tailor login --profile ${name}`", ["login"]],
    ["a pipe", "echo '{}' | tailor function run --arg -", ["function", "run"]],
    ["a command substitution", 'TOKEN="$(tailor auth token)"', ["auth", "token"]],
    ["npx and the package name", "Run `npx @tailor-platform/sdk@latest init`.", ["init"]],
  ])("finds a command after %s", (_, text, words) => {
    expect(mentionsIn("src/message.ts", text)).toEqual([{ line: 1, words }]);
  });

  test.each([
    ["a config file name", "Edit `tailor.config.ts`."],
    ["the CLI name alone", "The `tailor` CLI."],
    ["a placeholder", "Run `tailor <command> --help`."],
    ["prose that goes on after a comma", '"tailor name, to avoid rewriting it."'],
  ])("finds nothing in %s", (_, text) => {
    expect(mentionsIn("src/message.ts", text)).toEqual([]);
  });

  test("finds the scripts of a package.json", () => {
    const text = `{\n  "scripts": {\n    "deploy": "pnpm generate && tailor deploy --yes",\n    "seed": "tailor seed apply"\n  }\n}\n`;

    expect(mentionsIn("package.json", text)).toEqual([
      { line: 3, words: ["deploy"] },
      { line: 4, words: ["seed", "apply"] },
    ]);
  });

  test("finds the commands of a shell code block and leaves other blocks alone", () => {
    const text = [
      "```sh",
      "npx tailor workspace list",
      "$ tailor deploy",
      "```",
      "",
      "```text",
      "tailor applies the plan",
      "```",
    ].join("\n");

    expect(mentionsIn("docs/guide.md", text)).toEqual([
      { line: 2, words: ["workspace", "list"] },
      { line: 3, words: ["deploy"] },
    ]);
  });

  test.each([
    ["in a list item", "1. Deploy:\n\n   ```bash\n   tailor deploy\n   ```\n"],
    ["in a blockquote", "> Deploy:\n>\n> ```bash\n> tailor deploy\n> ```\n"],
    ["with CRLF line endings", "Deploy:\r\n\r\n```bash\r\ntailor deploy\r\n```\r\n"],
  ])("finds the commands of a shell code block %s", (_, text) => {
    expect(mentionsIn("docs/guide.md", text)).toEqual([{ line: 4, words: ["deploy"] }]);
  });
});

describe("unknownCommandReason", () => {
  const leaf = (name: string, aliases?: string[]) =>
    defineCommand({ name, aliases, run: () => undefined });
  const root = defineCommand({
    name: "tailor",
    subCommands: {
      deploy: leaf("deploy"),
      function: defineCommand({
        name: "function",
        subCommands: { run: leaf("run", ["test-run"]) },
      }),
      tailordb: defineCommand({ name: "tailordb", subCommands: { truncate: leaf("truncate") } }),
      workflow: lazy(defineCommand({ name: "workflow" }), async () =>
        defineCommand({ name: "workflow", subCommands: { prune: leaf("prune") } }),
      ),
    },
  });
  const plugins = new Map<string, AnyCommand>([
    [
      "setup",
      defineCommand({
        name: "tailor-setup",
        subCommands: {
          ci: defineCommand({ name: "ci", subCommands: { branch: leaf("branch") } }),
          update: leaf("update"),
        },
      }),
    ],
    [
      "tailordb-erd",
      defineCommand({ name: "tailor-tailordb-erd", subCommands: { export: leaf("export") } }),
    ],
  ]);

  test.each([
    ["a subcommand", ["function", "run"]],
    ["an alias", ["function", "test-run"]],
    ["a positional argument after a command without subcommands", ["deploy", "apps"]],
    ["a plugin", ["setup", "ci", "branch"]],
    ["a plugin under a command", ["tailordb", "erd", "export"]],
    ["a subcommand of a lazily loaded command", ["workflow", "prune"]],
  ])("accepts %s", async (_, words) => {
    expect(await unknownCommandReason(root, plugins, words)).toBeUndefined();
  });

  test.each([
    [["setup", "ci", "update"], 'no "update" under "tailor setup ci"'],
    [["functions", "run"], 'no "functions" under "tailor"'],
    [["workflow", "purge"], 'no "purge" under "tailor workflow"'],
  ])("rejects %j", async (words, reason) => {
    expect(await unknownCommandReason(root, plugins, words)).toBe(reason);
  });
});
