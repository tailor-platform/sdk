import { arg, defineCommand } from "politty";
import {
  type CandidateResult,
  type CompletionCandidate,
  type CompletionContext,
  CompletionDirective,
  formatForShell,
  generateCandidates,
  parseCompletionContext,
} from "politty/completion";
import { z } from "zod";
import { describeFieldType } from "./inspect";
import {
  extractMethodName,
  getInputFieldByName,
  getMethodDescriptor,
  nestedMessageOf,
} from "./proto-reflect";
import type { AnyCommand } from "politty";

const FIELD_OPTION_NAMES = new Set(["field", "f"]);

function findApiEndpoint(argv: string[]): string | undefined {
  // Locate the "api" subcommand token, then find the first non-option,
  // non-option-value token after it.
  const apiIdx = argv.indexOf("api");
  if (apiIdx < 0) return undefined;

  // Options that take a value — only need the ones the api command knows about.
  // Boolean flags don't consume the next token.
  const valueTakingOptions = new Set([
    "--workspace-id",
    "-w",
    "--profile",
    "-p",
    "--config",
    "-c",
    "--body",
    "-b",
    "--field",
    "-f",
  ]);

  let i = apiIdx + 1;
  // Stop one before the trailing word being completed.
  const last = argv.length - 1;
  while (i < last) {
    const token = argv[i] ?? "";
    if (token === "--") {
      i++;
      continue;
    }
    if (token.startsWith("-")) {
      const eqIdx = token.indexOf("=");
      const optName = eqIdx < 0 ? token : token.slice(0, eqIdx);
      if (eqIdx < 0 && valueTakingOptions.has(optName)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    return token;
  }
  return undefined;
}

export function generateApiFieldCandidates(
  context: CompletionContext,
  argv: string[],
): CandidateResult | undefined {
  if (context.subcommandPath[0] !== "api") return undefined;
  if (context.completionType !== "option-value") return undefined;
  const optName = context.targetOption?.cliName ?? context.targetOption?.name;
  if (!optName || !FIELD_OPTION_NAMES.has(optName)) return undefined;

  const word = context.currentWord;
  if (word.includes("=")) return undefined;

  const endpoint = findApiEndpoint(argv);
  if (!endpoint) return undefined;

  const method = getMethodDescriptor(extractMethodName(endpoint));
  if (!method) return undefined;

  const lastDot = word.lastIndexOf(".");
  const prefix = lastDot < 0 ? "" : word.slice(0, lastDot + 1);
  const segments = prefix === "" ? [] : prefix.slice(0, -1).split(".");

  let currentMessage = method.input;
  for (const segment of segments) {
    const f = getInputFieldByName(currentMessage, segment);
    if (!f) return undefined;
    const nested = nestedMessageOf(f);
    if (!nested) return undefined;
    currentMessage = nested;
  }

  const candidates: CompletionCandidate[] = [];
  for (const f of currentMessage.fields) {
    const isMessage =
      f.fieldKind === "message" || (f.fieldKind === "list" && f.listKind === "message");
    const suffix = isMessage ? "." : "";
    candidates.push({
      value: `${prefix}${f.localName}${suffix}`,
      description: describeFieldType(f),
      type: "value",
    });
  }

  return {
    candidates,
    directive:
      CompletionDirective.NoFileCompletion |
      CompletionDirective.NoSpace |
      CompletionDirective.FilterPrefix,
  };
}

function detectInlinePrefix(currentWord: string): string | undefined {
  if (currentWord.startsWith("--") && currentWord.includes("=")) {
    return currentWord.slice(0, currentWord.indexOf("=") + 1);
  }
  return undefined;
}

const completeArgsSchema = z.object({
  shell: arg(z.enum(["bash", "zsh", "fish"]), {
    description: "Target shell for output formatting",
  }),
  args: arg(z.array(z.string()).default([]), {
    positional: true,
    description: "Arguments to complete",
    variadic: true,
  }),
});

interface CommandWithSubCommands {
  subCommands?: Record<string, AnyCommand>;
}

export function applyApiAwareCompletion(rootCommand: AnyCommand): void {
  const root = rootCommand as CommandWithSubCommands;
  if (!root.subCommands) return;
  root.subCommands.__complete = defineCommand({
    name: "__complete",
    args: completeArgsSchema,
    description: "Generate completion candidates",
    run: (args) => {
      const argv = args.args;
      const context = parseCompletionContext(argv, rootCommand);
      const result = generateApiFieldCandidates(context, argv) ?? generateCandidates(context);
      const inlinePrefix = detectInlinePrefix(context.currentWord);
      const output = formatForShell(result, {
        shell: args.shell,
        currentWord: inlinePrefix
          ? context.currentWord.slice(inlinePrefix.length)
          : context.currentWord,
        ...(inlinePrefix !== undefined ? { inlinePrefix } : {}),
      });
      // eslint-disable-next-line no-restricted-syntax -- shell completion writes to stdout
      console.log(output);
    },
  });
}
