import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

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
const stdoutDecoder = new StringDecoder("utf8");
const stderrDecoder = new StringDecoder("utf8");
function capture(chunk, stream, decoder) {
  writeSync(log, chunk);
  stream.write(chunk);
  tail = (tail + decoder.write(chunk)).slice(-4000);
}
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => capture(chunk, process.stdout, stdoutDecoder));
child.stderr.on("data", (chunk) => capture(chunk, process.stderr, stderrDecoder));
let startFailed = false;
child.on("error", (error) => {
  startFailed = true;
  capture(
    Buffer.from(`Failed to start command: ${error.message}\n`),
    process.stderr,
    stderrDecoder,
  );
});
child.on("close", (code, signal) => {
  closeSync(log);
  tail = (tail + stdoutDecoder.end() + stderrDecoder.end()).slice(-4000);
  const exitCode = startFailed
    ? 1
    : (code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
  const escape = (value) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  appendFileSync(
    summary,
    [
      "### Generate diagnostics",
      "Command argv (JSON):",
      `<pre>${escape(JSON.stringify([command, ...args]))}</pre>`,
      `Exit code: ${exitCode}`,
      `Full log artifact: ${artifact}`,
      ...(exitCode === 0 ? [] : ["Last diagnostic output:", `<pre>${escape(tail)}</pre>`]),
      "",
    ].join("\n\n"),
  );
  process.exitCode = exitCode;
});
