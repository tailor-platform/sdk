// Drives changeset-publish.mjs as a subprocess with fake `pnpm` and `git`
// executables first on PATH. The publish outputs follow Release run logs,
// escape sequences included, because the script parses them.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./changeset-publish.mjs", import.meta.url));

const fakePnpm = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const log = process.env.FAKE_LOG;
const record = (call) => {
  appendFileSync(log, call + "\\n");
  return readFileSync(log, "utf8").split("\\n").filter((line) => line === call).length;
};
const [command, ...args] = process.argv.slice(2);
if (command === "changeset" && args[0] === "publish") {
  const attempt = scenario.publishes[record("publish") - 1];
  setTimeout(() => {
    if (!attempt.skipOutputFile) appendFileSync(process.env.CHANGESETS_OUTPUT, "");
    for (const tag of attempt.tags ?? []) {
      const packageName = tag.slice(0, tag.lastIndexOf("@"));
      appendFileSync(process.env.CHANGESETS_OUTPUT, JSON.stringify({ type: "git-tag", tag, packageName }) + "\\n");
    }
    process.stdout.write(attempt.output);
    process.exit(attempt.code);
  }, attempt.delayMs ?? 0);
} else if (command === "info" && args[1] === "--json") {
  const [name] = args;
  const calls = record("info " + name);
  const listed = Object.entries(scenario.unlistedCalls)
    .filter(([spec, unlisted]) => spec.startsWith(name + "@") && unlisted >= 0 && calls > unlisted)
    .map(([spec]) => spec.slice(name.length + 1));
  if ((scenario.firstPublish ?? []).includes(name)) {
    if (listed.length === 0) {
      process.stdout.write(JSON.stringify({ error: { code: "ERR_PNPM_FETCH_404", message: "GET " + name + ": Not Found - 404" } }));
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({ name, versions: listed }));
  } else {
    process.stdout.write(JSON.stringify({ name, versions: ["0.0.1", ...listed] }));
  }
} else {
  process.stderr.write("unexpected pnpm call: " + process.argv.slice(2).join(" "));
  process.exit(2);
}
`;

const fakeGit = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const [command, flag, tag] = process.argv.slice(2);
if (command !== "tag" || flag !== "--list") {
  process.stderr.write("unexpected git call: " + process.argv.slice(2).join(" "));
  process.exit(2);
}
appendFileSync(process.env.FAKE_LOG, "git tag " + tag + "\\n");
if ((scenario.gitTags ?? []).includes(tag)) process.stdout.write(tag + "\\n");
`;

// `unlistedCalls` maps each queried name@version to how many `pnpm info`
// calls for its package leave it out; -1 never lists it.
function run(t, scenario, { timeout = "30", env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "changeset-publish-"));
  t.after(() => rmSync(dir, { recursive: true }));
  for (const [name, source] of [
    ["pnpm", fakePnpm],
    ["git", fakeGit],
  ]) {
    writeFileSync(join(dir, name), source);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
  writeFileSync(join(dir, "calls.log"), "");
  const childEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    FAKE_SCENARIO: join(dir, "scenario.json"),
    FAKE_LOG: join(dir, "calls.log"),
    CHANGESETS_OUTPUT: join(dir, "changesets-output.ndjson"),
    ...env,
  };
  const result = spawnSync(process.execPath, [script, "--timeout", timeout, "--interval", "0.01"], {
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(childEnv).filter(([, value]) => value !== undefined)),
  });
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { ...result, calls, publishCount: calls.filter((call) => call === "publish").length };
}

const seed = "@tailor-platform/sdk-plugin-seed@0.6.1";
const setup = "@tailor-platform/sdk-plugin-setup@0.13.1";
const listedNow = (...specs) => Object.fromEntries(specs.map((spec) => [spec, 0]));

const successOutput = `🦋 changeset v3.0.3

These packages will be published as they were not found in the registry:
@tailor-platform/sdk@2.33.0
@tailor-platform/sdk-plugin-seed@0.6.1
1 packages are already published.
\u001b[?25l◒  ━━━━━━━━ Publishing packages...
\u001b[1G\u001b[J◐  ━━━━━━━━ Publishing packages (1/2)...
\u001b[1G\u001b[J◇  Successfully published:
@tailor-platform/sdk@2.33.0
@tailor-platform/sdk-plugin-seed@0.6.1
\u001b[?25h\u001b[?25l◒  Creating git tags...
\u001b[1G\u001b[J◇  Created git tags.
\u001b[?25h
`;

const stagedOutput = `🦋 changeset v3.0.3

These packages will be published as they were not found in the registry:
@tailor-platform/sdk-plugin-seed@0.6.1
@tailor-platform/sdk-plugin-setup@0.13.1
6 packages are already published.
\u001b[?25l◒  ━━━━━━━━ Publishing packages...
\u001b[1G\u001b[J◐  ━━━━━━━━ Publishing packages (1/2)...
\u001b[1G\u001b[J\u001b[?25h
Some packages failed to publish:
@tailor-platform/sdk-plugin-seed@0.6.1
└ ERR_PNPM_FAILED_TO_PUBLISH: Failed to publish package @tailor-platform/sdk-plugin-seed@0.6.1 (status 409 Conflict): {"success":false,"error":"Cannot publish over previously staged version \\"0.6.1\\"."}
@tailor-platform/sdk-plugin-setup@0.13.1
└ ERR_PNPM_FAILED_TO_PUBLISH: Failed to publish package @tailor-platform/sdk-plugin-setup@0.13.1 (status 409 Conflict): {"success":false,"error":"Cannot publish over previously staged version \\"0.13.1\\"."}
🦋 Exited with code 1
`;

const partialOutput = (failures) => `🦋 changeset v3.0.3

These packages will be published as they were not found in the registry:
@tailor-platform/create-sdk@2.32.0
@tailor-platform/sdk@2.32.0
@tailor-platform/sdk-plugin-setup@0.13.0
5 packages are already published.
\u001b[?25l◒  ━━━━━━━━ Publishing packages...
\u001b[1G\u001b[J◐  ━━━━━━━━ Publishing packages (1/3)...
\u001b[1G\u001b[J◇  Successfully published:
@tailor-platform/sdk@2.32.0
\u001b[?25h
Some packages failed to publish:
${failures}
\u001b[?25l◒  Creating git tags...
\u001b[1G\u001b[J◇  Created git tags.
\u001b[?25h🦋 Exited with code 1
`;

const failure = (spec, status, body) =>
  `${spec}\n└ ERR_PNPM_FAILED_TO_PUBLISH: Failed to publish package ${spec} (status ${status}): ${body}`;
const stagedFailure = (spec) =>
  failure(
    spec,
    "409 Conflict",
    `{"success":false,"error":"Cannot publish over previously staged version \\"${spec.slice(spec.lastIndexOf("@") + 1)}\\"."}`,
  );

const nothingToPublish = `🦋 changeset v3.0.3
No unpublished projects to publish.
`;

test("waits until npm lists every version the publish tagged", (t) => {
  const result = run(t, {
    publishes: [{ code: 0, output: successOutput, tags: ["@tailor-platform/sdk@2.33.0", seed] }],
    unlistedCalls: { "@tailor-platform/sdk@2.33.0": 2, [seed]: 0 },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "publish",
    "info @tailor-platform/sdk",
    "info @tailor-platform/sdk",
    "info @tailor-platform/sdk",
    "info @tailor-platform/sdk-plugin-seed",
  ]);
  assert.ok(result.stdout.includes("Successfully published:"), "forwards the publish output");
});

test("fails when a published version does not show up on npm before the deadline", (t) => {
  const result = run(
    t,
    {
      publishes: [{ code: 0, output: successOutput, tags: ["@tailor-platform/sdk@2.33.0"] }],
      unlistedCalls: { "@tailor-platform/sdk@2.33.0": -1 },
    },
    { timeout: "0.2" },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /::error::@tailor-platform\/sdk@2\.33\.0 is not visible on npm after 0\.2s/,
  );
});

test("keeps polling while npm answers 404 for a package's first version", (t) => {
  const result = run(t, {
    publishes: [
      { code: 0, output: successOutput, tags: ["@tailor-platform/sdk-plugin-new@0.1.0"] },
    ],
    unlistedCalls: { "@tailor-platform/sdk-plugin-new@0.1.0": 2 },
    firstPublish: ["@tailor-platform/sdk-plugin-new"],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter((call) => call.startsWith("info ")).length, 3);
});

test("prints pnpm's last error when a version does not show up", (t) => {
  const result = run(
    t,
    {
      publishes: [
        { code: 0, output: successOutput, tags: ["@tailor-platform/sdk-plugin-new@0.1.0"] },
      ],
      unlistedCalls: { "@tailor-platform/sdk-plugin-new@0.1.0": -1 },
      firstPublish: ["@tailor-platform/sdk-plugin-new"],
    },
    { timeout: "0.2" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERR_PNPM_FETCH_404/);
});

test("publishes again once npm lists the versions that failed only with the staged 409", (t) => {
  const result = run(t, {
    publishes: [
      { code: 1, output: stagedOutput },
      { code: 0, output: nothingToPublish },
    ],
    unlistedCalls: { [seed]: 1, [setup]: 0 },
    gitTags: [seed, setup],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "publish",
    "info @tailor-platform/sdk-plugin-seed",
    "info @tailor-platform/sdk-plugin-seed",
    "info @tailor-platform/sdk-plugin-setup",
    `git tag ${seed}`,
    `git tag ${setup}`,
    "publish",
  ]);
  assert.doesNotMatch(result.stdout, /::error::/);
});

test("waits for the versions published alongside the staged failures before publishing again", (t) => {
  const result = run(t, {
    publishes: [
      {
        code: 1,
        output: partialOutput(stagedFailure("@tailor-platform/create-sdk@2.32.0")),
        tags: ["@tailor-platform/sdk@2.32.0"],
      },
      { code: 0, output: successOutput, tags: ["@tailor-platform/sdk-plugin-setup@0.13.0"] },
    ],
    unlistedCalls: {
      "@tailor-platform/sdk@2.32.0": 1,
      "@tailor-platform/create-sdk@2.32.0": 0,
      "@tailor-platform/sdk-plugin-setup@0.13.0": 1,
    },
    gitTags: ["@tailor-platform/create-sdk@2.32.0"],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "publish",
    "info @tailor-platform/sdk",
    "info @tailor-platform/sdk",
    "info @tailor-platform/create-sdk",
    "git tag @tailor-platform/create-sdk@2.32.0",
    "publish",
    "info @tailor-platform/sdk-plugin-setup",
    "info @tailor-platform/sdk-plugin-setup",
  ]);
});

test("does not publish again when another failure accompanies the staged 409", (t) => {
  const result = run(t, {
    publishes: [
      {
        code: 1,
        output: partialOutput(
          [
            failure(
              "@tailor-platform/create-sdk@2.32.0",
              "503 Service Unavailable",
              '{"error":"Service Unavailable"}',
            ),
            stagedFailure("@tailor-platform/sdk-plugin-setup@0.13.0"),
          ].join("\n"),
        ),
        tags: ["@tailor-platform/sdk@2.32.0"],
      },
    ],
    unlistedCalls: listedNow("@tailor-platform/sdk@2.32.0"),
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, ["publish", "info @tailor-platform/sdk"]);
});

test("does not publish again on a 409 other than the staged one", (t) => {
  const result = run(t, {
    publishes: [
      {
        code: 1,
        output: stagedOutput.replace(
          /\{"success":false,"error":"Cannot publish over previously staged version \\"0\.6\.1\\"\."\}/,
          '{"error":"Failed to save packument. A common cause is if you try to publish a new package before the previous package has been fully processed."}',
        ),
      },
    ],
    unlistedCalls: listedNow(setup),
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, ["publish"]);
});

test("keeps the exit code of a publish that fails before reporting any package", (t) => {
  const result = run(t, {
    publishes: [{ code: 3, output: "🦋 error Error: unexpected\n", skipOutputFile: true }],
    unlistedCalls: {},
  });
  assert.equal(result.status, 3, result.stderr);
  assert.deepEqual(result.calls, ["publish"]);
  assert.equal(result.stderr, "");
});

test("refuses to run outside changesets/action", (t) => {
  const result = run(
    t,
    { publishes: [], unlistedCalls: {} },
    { env: { CHANGESETS_OUTPUT: undefined } },
  );
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.match(result.stderr, /CHANGESETS_OUTPUT is not set/);
});

test("rejects a timeout that is not a positive number", (t) => {
  const result = run(t, { publishes: [], unlistedCalls: {} }, { timeout: "abc" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.match(result.stderr, /--timeout and --interval must be positive/);
});

test("fails without publishing again when a staged version does not show up on npm", (t) => {
  const result = run(
    t,
    {
      publishes: [{ code: 1, output: stagedOutput }],
      unlistedCalls: { [seed]: -1, [setup]: 0 },
    },
    { timeout: "0.2" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.publishCount, 1);
  assert.match(
    result.stdout,
    /::error::@tailor-platform\/sdk-plugin-seed@0\.6\.1 is not visible on npm/,
  );
});

test("publishes at most twice even when the second publish fails only with the staged 409", (t) => {
  const result = run(t, {
    publishes: [
      { code: 1, output: stagedOutput },
      { code: 1, output: partialOutput(stagedFailure("@tailor-platform/sdk-plugin-setup@0.13.0")) },
    ],
    unlistedCalls: listedNow(seed, setup, "@tailor-platform/sdk-plugin-setup@0.13.0"),
    gitTags: [seed, setup],
  });
  assert.equal(result.status, 1);
  assert.equal(result.publishCount, 2);
});

test("fails after publishing again when a staged version has no git tag", (t) => {
  const result = run(t, {
    publishes: [
      { code: 1, output: stagedOutput },
      { code: 0, output: nothingToPublish },
    ],
    unlistedCalls: listedNow(seed, setup),
    gitTags: [setup],
  });
  assert.equal(result.status, 1);
  assert.equal(result.publishCount, 2);
  assert.match(result.stdout, /::error::@tailor-platform\/sdk-plugin-seed@0\.6\.1 .*no git tag/);
  assert.doesNotMatch(result.stdout, /::error::@tailor-platform\/sdk-plugin-setup/);
});

test("gives the final wait its own deadline after a slow second publish", (t) => {
  const result = run(
    t,
    {
      publishes: [
        { code: 1, output: stagedOutput },
        { code: 0, output: successOutput, tags: ["@tailor-platform/sdk@2.33.0"], delayMs: 1500 },
      ],
      unlistedCalls: { ...listedNow(seed, setup), "@tailor-platform/sdk@2.33.0": 1 },
      gitTags: [seed, setup],
    },
    { timeout: "1" },
  );
  assert.equal(result.status, 0, result.stderr);
});
