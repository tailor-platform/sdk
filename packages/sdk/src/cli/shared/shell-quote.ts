/**
 * Command lines for a suggested command: one line when every supported shell reads it the same
 * way, otherwise one line per Windows shell.
 */
export type ShellCommandLines =
  | { kind: "shared"; commandLine: string }
  | { kind: "perShell"; powershell: string; cmd: string };

const POSIX_BARE_ARG = /^[A-Za-z0-9_./:=@+-]+$/;
const CMD_BARE_ARG = /^[A-Za-z0-9_./:=@+\\-]+$/;
// PowerShell expands `$` and backtick escapes inside double quotes and reads `“ ” „` as `"`,
// cmd.exe expands `%` even inside quotes, and a `"` or a trailing backslash changes where the
// quoted argument ends.
const WINDOWS_DOUBLE_QUOTE_UNSAFE = /[%$"`“”„\p{Cc}]|\\$/u;
// Windows PowerShell 5.1 passes these to programs differently from PowerShell 7.3+.
const POWERSHELL_VERSION_SENSITIVE = /"|\s.*\\$/;

function quotePosixArg(value: string): string {
  if (POSIX_BARE_ARG.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isPowerShellBare(value: string): boolean {
  // A leading `@` splats, a lone `--` ends parameters, a leading digit reads as a number, and a
  // single-dash token with `.` or `:` reads as parameter syntax.
  return (
    CMD_BARE_ARG.test(value) &&
    !/^(@|[+-]?\.?\d)/.test(value) &&
    value !== "--" &&
    !/^-[^-].*[.:]/.test(value)
  );
}

function quotePowerShellArg(value: string): string {
  if (isPowerShellBare(value)) return value;
  return `'${value.replace(/['‘’‚‛]/g, "$&$&")}'`;
}

function quoteCmdArg(value: string): string {
  // Quoting a trailing backslash keeps a command routed through `cmd /c` from ending in one,
  // which PowerShell 7 doubles when it quotes the line.
  if (CMD_BARE_ARG.test(value) && !value.endsWith("\\")) return value;
  let quoted = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') {
      quoted += `${"\\".repeat(backslashes * 2)}""`;
    } else {
      // `%%cd:~,%` reads back as a literal `%` without cmd.exe expanding a `%NAME%` around it.
      quoted += `${"\\".repeat(backslashes)}${char === "%" ? "%%cd:~,%" : char}`;
    }
    backslashes = 0;
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

function formatWindowsCommandLines(argv: readonly string[]): ShellCommandLines {
  if (
    argv.every(
      (value) =>
        isPowerShellBare(value) || (value !== "" && !WINDOWS_DOUBLE_QUOTE_UNSAFE.test(value)),
    )
  ) {
    return {
      kind: "shared",
      commandLine: argv.map((value) => (isPowerShellBare(value) ? value : `"${value}"`)).join(" "),
    };
  }
  const cmd = argv.map(quoteCmdArg).join(" ");
  // Both PowerShell versions pass a `cmd` argument the same legacy way, so routing the cmd.exe
  // line through `cmd /c` keeps the arguments identical where their native quoting differs.
  const powershell = argv.some((value) => value === "" || POWERSHELL_VERSION_SENSITIVE.test(value))
    ? `cmd /d /s /c ${quotePowerShellArg(cmd)}`
    : argv.map(quotePowerShellArg).join(" ");
  return { kind: "perShell", powershell, cmd };
}

/**
 * Render an argv array as command lines that the current platform's shells run with every
 * argument delivered unchanged
 * @param {readonly string[]} argv - Executable name followed by its arguments
 * @returns {ShellCommandLines} One shared command line, or one per Windows shell
 */
export function formatShellCommandLines(argv: readonly string[]): ShellCommandLines {
  if (process.platform === "win32") return formatWindowsCommandLines(argv);
  return { kind: "shared", commandLine: argv.map(quotePosixArg).join(" ") };
}
