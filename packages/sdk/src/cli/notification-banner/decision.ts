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

/**
 * Commands whose subcommands are local-only except for the ones listed: `user` reads and edits
 * the stored logins, and only `user pat` talks to the platform. A bare `user` runs `user list`.
 */
const LOCAL_ONLY_EXCEPT: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["user", new Set(["pat"])],
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
 * The command and subcommand a command line invokes: its first two positional tokens, skipping
 * global flags politty accepts anywhere before them.
 * @param argv - Command-line arguments after the executable and script path
 * @returns Up to two names, stopping at a `--` separator
 */
export function commandPathFromArgv(argv: readonly string[]): string[] {
  const path: string[] = [];
  let skipNext = false;
  for (const token of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token === "--") break;
    if (token.startsWith("-")) {
      skipNext = !token.includes("=") && VALUE_FLAGS.has(token);
      continue;
    }
    path.push(token);
    if (path.length === 2) break;
  }
  return path;
}

function tokensBeforeSeparator(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf("--");
  return separator === -1 ? argv : argv.slice(0, separator);
}

/**
 * Decide from the command line and the environment alone whether the post-command banner's
 * lookup should be skipped. Terminal, JSON-mode, backoff and credential checks are the
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
  const [command, subcommand] = commandPathFromArgv(argv);
  if (command === undefined) return "no-command";
  if (command.startsWith("__") || EXCLUDED_COMMANDS.has(command)) return "excluded-command";
  const remote = LOCAL_ONLY_EXCEPT.get(command);
  if (remote && (subcommand === undefined || !remote.has(subcommand))) return "excluded-command";
  return undefined;
}
