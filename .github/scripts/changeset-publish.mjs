#!/usr/bin/env node
// changesets/action's publish script in release.yml. Runs `changeset publish`,
// waits until npm lists the versions it published, and publishes once more
// when every failure is npm's 409 for a version it still has staged.
//
// Usage: node changeset-publish.mjs [--timeout <seconds>] [--interval <seconds>]

import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify, stripVTControlCharacters } from "node:util";

const STAGED_CONFLICT = "Cannot publish over previously staged version";
const FAILURES_HEADER = "Some packages failed to publish:";
const PACKAGE_LINE = /^(?:@[^\s/@]+\/)?[^\s/@]+@\S+$/;

const execFileAsync = promisify(execFile);

const { values } = parseArgs({
  options: {
    timeout: { type: "string", default: "300" },
    interval: { type: "string", default: "10" },
  },
});
const timeoutSeconds = Number(values.timeout);
const intervalSeconds = Number(values.interval);
if (!(timeoutSeconds > 0 && intervalSeconds > 0)) {
  throw new Error("--timeout and --interval must be positive numbers of seconds");
}

const changesetsOutput = process.env.CHANGESETS_OUTPUT;
if (!changesetsOutput) {
  throw new Error("CHANGESETS_OUTPUT is not set; run this as changesets/action's publish script");
}
let readEventCount = 0;

// changesets/action reads the same `git-tag` events to tell what was published.
function takePublishedSpecs() {
  let lines;
  try {
    lines = readFileSync(changesetsOutput, "utf8").split("\n").filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const events = lines.slice(readEventCount).map((line) => JSON.parse(line));
  readEventCount = lines.length;
  return events.filter((event) => event.type === "git-tag").map((event) => event.tag);
}

function publish() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["changeset", "publish"], { stdio: ["inherit", "pipe", "pipe"] });
    const output = { stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"]) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (chunk) => {
        process[stream].write(chunk);
        output[stream] += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({
          code: code ?? 1,
          output: `${output.stdout}\n${output.stderr}`,
          published: takePublishedSpecs(),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

// The failed packages when every failure is the staged 409, otherwise none.
function onlyStagedFailures(output) {
  const failures = [];
  let inFailures = false;
  let spec;
  for (const line of stripVTControlCharacters(output).split("\n")) {
    const text = line.trim();
    if (text.includes(FAILURES_HEADER)) inFailures = true;
    else if (!inFailures) continue;
    else if (PACKAGE_LINE.test(text)) spec = text;
    else if (text.startsWith("└")) failures.push({ spec, staged: text.includes(STAGED_CONFLICT) });
  }
  return failures.length > 0 && failures.every((failure) => failure.staged)
    ? failures.map((failure) => failure.spec)
    : [];
}

// The check changesets makes before publishing a version.
async function isListed(spec) {
  const at = spec.lastIndexOf("@");
  const { stdout } = await execFileAsync("pnpm", ["info", spec.slice(0, at), "--json"], {
    timeout: 30_000,
  });
  return JSON.parse(stdout).versions.includes(spec.slice(at + 1));
}

async function waitUntilListed(specs) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (const spec of specs) {
    for (;;) {
      let error;
      try {
        if (await isListed(spec)) break;
      } catch (caught) {
        error = caught;
      }
      if (Date.now() >= deadline) {
        if (error) console.error(error.stdout || error.stderr || error.message);
        console.log(`::error::${spec} is not visible on npm after ${timeoutSeconds}s`);
        return false;
      }
      await sleep(intervalSeconds * 1000);
    }
  }
  return true;
}

async function hasGitTag(spec) {
  const { stdout } = await execFileAsync("git", ["tag", "--list", spec]);
  return stdout.trim() !== "";
}

async function main() {
  let attempt = await publish();
  const staged = onlyStagedFailures(attempt.output);
  const untagged = [];
  if (staged.length > 0) {
    console.log(`Publishing again once npm lists the staged versions: ${staged.join(", ")}`);
    if (!(await waitUntilListed([...attempt.published, ...staged]))) return 1;
    for (const spec of staged) {
      if (!(await hasGitTag(spec))) untagged.push(spec);
    }
    attempt = await publish();
  }
  if (!(await waitUntilListed(attempt.published))) return 1;
  for (const spec of untagged) {
    console.log(
      `::error::${spec} is on npm but has no git tag; create its tag and GitHub release by hand`,
    );
  }
  return untagged.length > 0 ? 1 : attempt.code;
}

process.exitCode = await main();
