import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

const [command, ...args] = process.argv.slice(2);
const {
  GENERATE_LOG_DIR: logDir,
  GENERATE_LOG_ARTIFACT: artifact,
  GITHUB_STEP_SUMMARY: summary,
} = process.env;
if (!command || !logDir || !artifact || !summary) {
  throw new Error(
    "A command, GENERATE_LOG_DIR, GENERATE_LOG_ARTIFACT, and GITHUB_STEP_SUMMARY are required.",
  );
}
mkdirSync(logDir, { recursive: true });
const log = openSync(join(logDir, "generate.log"), "w");
let tail = "";
function capture(chunk, stream) {
  writeSync(log, chunk);
  stream.write(chunk);
  tail = (tail + chunk.toString()).slice(-4000);
}
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
let startFailed = false;
child.on("error", (error) => {
  startFailed = true;
  capture(Buffer.from(`Failed to start command: ${error.message}\n`), process.stderr);
});
child.on("close", (code, signal) => {
  closeSync(log);
  const exitCode = startFailed
    ? 1
    : (code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
  const escape = (value) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  appendFileSync(
    summary,
    [
      "### Generate diagnostics",
      `<pre>${escape([command, ...args].join(" "))}</pre>`,
      `Exit code: ${exitCode}`,
      `Full log artifact: ${artifact}`,
      ...(exitCode === 0 ? [] : ["Last diagnostic output:", `<pre>${escape(tail)}</pre>`]),
      "",
    ].join("\n\n"),
  );
  process.exitCode = exitCode;
});
