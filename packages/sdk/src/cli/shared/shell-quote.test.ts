import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aroundAll, describe, expect, test } from "vitest";
import { formatShellCommandLines, type ShellCommandLines } from "./shell-quote";

const isWindows = process.platform === "win32";

const SAMPLE_ARGS = [
  "--profile=dev",
  "--workspace-id=12345678-1234-4abc-8def-123456789012",
  "--config=C:\\work\\tailor.config.ts",
  "-d",
  "--",
  "0001",
  "0x10",
  "1kb",
  "1.10",
  "-Dfoo.bar=baz",
  "-x:y",
  "@scope",
  "dev$1",
  "--profile=dev$1",
  "$env:PATH",
  "%APPDATA%.config.ts",
  "--config=%APPDATA%.config.ts",
  "a b%PATH%c",
  "%__CD__%",
  "%=ExitCode%",
  "%cd%",
  "%_TAILOR_QUOTE_PROBE%",
  "%%PATH%%",
  '%"',
  "100%",
  "x%y",
  "C:\\work\\!SECRET!\\tailor.config.ts",
  "C:\\Users\\Jane Doe\\tailor.config.ts",
  "C:\\Jane Doe\\",
  '{"key":"value"}',
  'say "hi" now',
  'a"&b',
  "it's",
  "Don’t",
  "“quoted”",
  "a&b|c<d>e^f",
  "(a);b,c",
  "<name>",
  "a`b",
  "",
  "ümlaut",
  "日本語",
  "全角　スペース",
  "😀",
];

// The launchers npm (`cmd-shim`) and pnpm install for a `tailor` bin, each passing a marker
// ahead of the forwarded arguments so the test can tell which one ran.
const NPM_CMD_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\tailor.js" npm-cmd %*',
  "",
].join("\r\n");
const NPM_PS1_SHIM = `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/tailor.js" npm-ps1 $args
  } else {
    & "$basedir/node$exe"  "$basedir/tailor.js" npm-ps1 $args
  }
  $ret=$LASTEXITCODE
} else {
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/tailor.js" npm-ps1 $args
  } else {
    & "node$exe"  "$basedir/tailor.js" npm-ps1 $args
  }
  $ret=$LASTEXITCODE
}
exit $ret
`;
const PNPM_CMD_SHIM = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\tailor.js" pnpm-cmd %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\tailor.js" pnpm-cmd %*',
  ")",
  "",
].join("\r\n");
const CAPTURE_SCRIPT =
  'require("node:fs").writeFileSync(process.env.CAPTURE_FILE, JSON.stringify(process.argv.slice(2)));\n';

interface ShellConfig {
  name: string;
  bin: string;
  /** An unquoted reference the shell expands to `_TAILOR_QUOTE_PROBE`'s value. */
  unquotedExpansion: string;
  commandLine: (lines: ShellCommandLines) => string;
  expectedMarker: (commandLine: string) => string;
  spawnArgs: (commandLine: string) => { file: string; args: string[]; verbatim?: boolean };
}

interface RunOutcome {
  marker?: unknown;
  argv?: unknown;
  commandLine?: string;
  status?: number | null;
  stderr?: string;
}

function writeBin(root: string, name: string, files: Record<string, string>): string {
  const bin = path.join(root, name);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "tailor.js"), CAPTURE_SCRIPT);
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(bin, fileName), content);
  }
  return bin;
}

function powershellConfig(name: string, exe: string, bin: string, prelude = ""): ShellConfig {
  return {
    name,
    bin,
    unquotedExpansion: "$env:_TAILOR_QUOTE_PROBE",
    commandLine: (lines) => (lines.kind === "shared" ? lines.commandLine : lines.powershell),
    expectedMarker: (commandLine) => (commandLine.startsWith("cmd ") ? "npm-cmd" : "npm-ps1"),
    spawnArgs: (commandLine) => ({
      file: exe,
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(`${prelude}${commandLine}`, "utf16le").toString("base64"),
      ],
    }),
  };
}

function shellConfigs(root: string): ShellConfig[] {
  if (!isWindows) {
    const bin = writeBin(root, "bin-posix", {});
    const shim = path.join(bin, "tailor");
    fs.writeFileSync(
      shim,
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, "tailor.js")}" posix "$@"\n`,
    );
    fs.chmodSync(shim, 0o755);
    return [
      {
        name: "sh",
        bin,
        unquotedExpansion: "$_TAILOR_QUOTE_PROBE",
        commandLine: (lines) => {
          if (lines.kind !== "shared") throw new Error("expected one shared command line");
          return lines.commandLine;
        },
        expectedMarker: () => "posix",
        spawnArgs: (commandLine) => ({ file: "/bin/sh", args: ["-c", commandLine] }),
      },
    ];
  }
  const npmBin = writeBin(root, "bin-npm", {
    "tailor.cmd": NPM_CMD_SHIM,
    "tailor.ps1": NPM_PS1_SHIM,
  });
  const pnpmBin = writeBin(root, "bin-pnpm", { "tailor.cmd": PNPM_CMD_SHIM });
  const cmdConfig = (name: string, bin: string, marker: string): ShellConfig => ({
    name,
    bin,
    unquotedExpansion: "%_TAILOR_QUOTE_PROBE%",
    commandLine: (lines) => (lines.kind === "shared" ? lines.commandLine : lines.cmd),
    expectedMarker: () => marker,
    spawnArgs: (commandLine) => ({
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      verbatim: true,
    }),
  });
  return [
    cmdConfig("cmd.exe (npm shim)", npmBin, "npm-cmd"),
    cmdConfig("cmd.exe (pnpm shim)", pnpmBin, "pnpm-cmd"),
    powershellConfig("Windows PowerShell 5.1", "powershell.exe", npmBin),
    powershellConfig("PowerShell 7", "pwsh.exe", npmBin),
    powershellConfig(
      "PowerShell 7 (legacy argument passing)",
      "pwsh.exe",
      npmBin,
      "$PSNativeCommandArgumentPassing = 'Legacy'\n",
    ),
  ];
}

async function runInShell(
  config: ShellConfig,
  commandLine: string,
  captureFile: string,
): Promise<RunOutcome> {
  const { file, args, verbatim } = config.spawnArgs(commandLine);
  const { status, stderr } = await new Promise<{ status: number | null; stderr: string }>(
    (resolve) => {
      const child = spawn(file, args, {
        env: {
          ...process.env,
          PATH: `${config.bin}${path.delimiter}${process.env.PATH ?? ""}`,
          CAPTURE_FILE: captureFile,
          _TAILOR_QUOTE_PROBE: "expanded",
        },
        windowsVerbatimArguments: verbatim,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let errorOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });
      child.on("error", (error) => resolve({ status: null, stderr: String(error) }));
      child.on("close", (code) => resolve({ status: code, stderr: errorOutput }));
    },
  );
  if (!fs.existsSync(captureFile)) return { commandLine, status, stderr };
  const [marker, ...argv] = JSON.parse(fs.readFileSync(captureFile, "utf8")) as unknown[];
  return { marker, argv };
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

describe("formatShellCommandLines", () => {
  let tempDir: string;
  let configs: ShellConfig[];

  aroundAll(async (runSuite) => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tailor-shell-quote-")));
    configs = shellConfigs(tempDir);
    try {
      await runSuite();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runs commands through shells that expand an unquoted variable reference", async () => {
    const outcomes = await Promise.all(
      configs.map((config, configIndex) =>
        runInShell(
          config,
          `tailor probe ${config.unquotedExpansion}`,
          path.join(tempDir, `control-${configIndex}.json`),
        ),
      ),
    );

    expect(configs).toHaveLength(isWindows ? 5 : 1);
    expect(outcomes).toEqual(
      configs.map((config) => ({
        marker: config.expectedMarker("tailor"),
        argv: ["probe", "expanded"],
      })),
    );
  }, 120_000);

  test("delivers every argument unchanged when the rendered command runs in each shell", async () => {
    const cases = [
      ...SAMPLE_ARGS.map((arg) => ({ name: JSON.stringify(arg), args: ["probe", arg, "--end"] })),
      { name: "all samples in one command", args: ["probe", ...SAMPLE_ARGS, "--end"] },
    ];
    const jobs = configs.flatMap((config, configIndex) =>
      cases.map((testCase, caseIndex) => ({ config, testCase, configIndex, caseIndex })),
    );
    const outcomes = await mapWithLimit(
      jobs,
      8,
      async ({ config, testCase, configIndex, caseIndex }) => {
        const commandLine = config.commandLine(
          formatShellCommandLines(["tailor", ...testCase.args]),
        );
        const captureFile = path.join(tempDir, `${configIndex}-${caseIndex}.json`);
        return {
          key: `${config.name} ${testCase.name}`,
          outcome: await runInShell(config, commandLine, captureFile),
          expected: { marker: config.expectedMarker(commandLine), argv: testCase.args },
        };
      },
    );

    expect(outcomes).toHaveLength(configs.length * cases.length);
    expect(Object.fromEntries(outcomes.map(({ key, outcome }) => [key, outcome]))).toEqual(
      Object.fromEntries(outcomes.map(({ key, expected }) => [key, expected])),
    );
  }, 600_000);

  test("keeps one shared command line when no argument needs shell-specific quoting", () => {
    expect(
      formatShellCommandLines([
        "tailor",
        "deploy",
        "--config",
        "C:\\Users\\Jane Doe\\tailor.config.ts",
      ]),
    ).toEqual({
      kind: "shared",
      commandLine: isWindows
        ? 'tailor deploy --config "C:\\Users\\Jane Doe\\tailor.config.ts"'
        : "tailor deploy --config 'C:\\Users\\Jane Doe\\tailor.config.ts'",
    });
  });
});
