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
  descendableMessageOf,
  extractMethodName,
  getInputFieldByName,
  getMethodDescriptor,
} from "./proto-reflect";
import type { DescField } from "@bufbuild/protobuf";
import type { AnyCommand } from "politty";

const FIELD_OPTION_NAMES = new Set(["field", "f"]);

/**
 * True when a proto field can be set as a `--field` leaf assignment without
 * dot-notation. Mirrors the assign-time accept set in `mergeFieldEntries`,
 * so completion never suggests fields that would unconditionally error.
 * @param field - Proto field to test
 * @returns True if the field can be assigned via `--field key=value`
 */
function isAssignableLeaf(field: DescField): boolean {
  if (field.fieldKind === "scalar" || field.fieldKind === "enum") return true;
  if (field.fieldKind === "list") {
    return field.listKind === "scalar" || field.listKind === "enum";
  }
  return false;
}

// Options that take a value — local api options plus the value-taking
// global options (env-file family) that may appear before or after the
// `api` subcommand. Boolean flags such as --inspect, --list, --json,
// --verbose don't consume the next token.
const VALUE_TAKING_OPTIONS = new Set([
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
  "--env-file",
  "-e",
  "--env-file-if-exists",
]);

function findApiEndpoint(argv: string[]): string | undefined {
  // Walk argv from the start so option *values* matching the literal
  // "api" (e.g. `--env-file api`) don't fool us into treating them as the
  // subcommand. Once we step past `api`, find the first non-option,
  // non-option-value token, which is the endpoint positional.
  const last = argv.length - 1;
  let i = 0;
  let seenTerminator = false;
  let pastApi = false;

  while (i < last) {
    const token = argv[i] ?? "";

    if (!seenTerminator && token === "--") {
      seenTerminator = true;
      i++;
      continue;
    }
    if (!seenTerminator && token.startsWith("-")) {
      const eqIdx = token.indexOf("=");
      const optName = eqIdx < 0 ? token : token.slice(0, eqIdx);
      if (eqIdx < 0 && VALUE_TAKING_OPTIONS.has(optName)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (!pastApi) {
      if (token !== "api") return undefined;
      pastApi = true;
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

  const inlinePrefix = detectInlinePrefix(context.currentWord);
  const word = inlinePrefix ? context.currentWord.slice(inlinePrefix.length) : context.currentWord;
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
    const nested = descendableMessageOf(f);
    if (!nested) return undefined;
    currentMessage = nested;
  }

  const candidates: CompletionCandidate[] = [];
  for (const f of currentMessage.fields) {
    const descendable = descendableMessageOf(f) !== undefined;
    if (!descendable && !isAssignableLeaf(f)) continue;
    const suffix = descendable ? "." : "";
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
