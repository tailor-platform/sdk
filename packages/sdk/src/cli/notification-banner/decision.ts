import { parseBoolean } from "#/cli/shared/parse-boolean";

/** Environment variable that turns the post-command notification banner off (`off`, `0`, `false`). */
const BANNER_ENV_VAR = "TAILOR_NOTIFICATION_BANNER";

/**
 * Top-level commands after which the banner is never shown: the notification commands
 * themselves, login and logout flows, raw API calls, the query REPL, and commands that never
 * talk to the platform (so the lookup would only add module-loading cost).
 */
const EXCLUDED_COMMANDS: ReadonlySet<string> = new Set([
  "notification",
  "login",
  "logout",
  "auth",
  "api",
  "query",
  "init",
  "generate",
  "show",
  "plugin",
  "skills",
  "completion",
  "crashreport",
  "upgrade",
  "profile",
  "open",
]);

// Global flags (shared/args.ts createCommonArgs and workspaceArgs) that take a value in the
// next token when written without `=`.
const VALUE_FLAGS = new Set([
  "--profile",
  "-p",
  "--workspace-id",
  "-w",
  "--env-file",
  "-e",
  "--env-file-if-exists",
]);

const HELP_FLAGS = new Set(["--help", "-h", "--help-json", "--version", "-v"]);

/**
 * Why the unread-notification lookup is not started for this invocation.
 * - `disabled`: the environment turned the banner off
 * - `help`: the invocation asks for help or the version
 * - `no-command`: no subcommand on the command line
 * - `excluded-command`: a command the banner never follows
 */
export type LookupSkipReason = "disabled" | "help" | "no-command" | "excluded-command";

/**
 * The top-level command a command line invokes: its first positional token, after any global
 * flags politty accepts before the subcommand.
 * @param argv - Command-line arguments after the executable and script path
 * @returns Command name, or undefined when there is none before a `--` separator
 */
export function commandNameFromArgv(argv: readonly string[]): string | undefined {
  let skipNext = false;
  for (const token of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token === "--") return undefined;
    if (token.startsWith("-")) {
      skipNext = !token.includes("=") && VALUE_FLAGS.has(token);
      continue;
    }
    return token;
  }
  return undefined;
}

function tokensBeforeSeparator(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf("--");
  return separator === -1 ? argv : argv.slice(0, separator);
}

/**
 * Decide from the command line and the environment alone whether the post-command banner's
 * lookup should be skipped. Terminal, JSON-mode, throttle and credential checks are the
 * caller's, since they depend on process state.
 * @param argv - Command-line arguments after the executable and script path
 * @param env - Environment to consult
 * @returns The reason to skip, or undefined to start the lookup
 */
export function lookupSkipReason(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LookupSkipReason | undefined {
  if (parseBoolean(env[BANNER_ENV_VAR]) === false) return "disabled";
  if (tokensBeforeSeparator(argv).some((token) => HELP_FLAGS.has(token))) return "help";
  const command = commandNameFromArgv(argv);
  if (command === undefined) return "no-command";
  if (command.startsWith("__") || EXCLUDED_COMMANDS.has(command)) return "excluded-command";
  return undefined;
}

/**
 * The profile named on the command line, if any: `--profile <name>`, `--profile=<name>` or
 * `-p <name>` before a `--` separator. The banner runs before politty parses arguments, so it
 * reads the flag itself; an unparseable form yields undefined and the environment decides.
 * @param argv - Command-line arguments after the executable and script path
 * @returns Profile name, or undefined when none is given
 */
export function profileFromArgv(argv: readonly string[]): string | undefined {
  const tokens = tokensBeforeSeparator(argv);
  for (const [i, token] of tokens.entries()) {
    if (token.startsWith("--profile=")) return token.slice("--profile=".length) || undefined;
    if (token === "--profile" || token === "-p") {
      const value = tokens[i + 1];
      return value !== undefined && !value.startsWith("-") ? value : undefined;
    }
  }
  return undefined;
}
