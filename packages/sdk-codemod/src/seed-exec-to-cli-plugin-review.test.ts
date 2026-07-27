import { describe, expect, test } from "vitest";
import transform, {
  reviewFindings,
} from "../codemods/v2/seed-exec-to-cli-plugin/scripts/transform";

const FORK_SETUP = `import { fork } from "node:child_process";

await new Promise<void>((resolve, reject) => {
  const child = fork("seed/exec.mjs", [], { env: process.env, stdio: "inherit" });
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("seed failed"))));
});
`;

describe("seed exec.mjs migration review", () => {
  test("declines fork() call sites and reports them for manual migration", () => {
    expect(transform(FORK_SETUP, "setup.ts")).toBeNull();
    expect(reviewFindings(FORK_SETUP, "setup.ts", "setup.ts")).toMatchObject([
      {
        file: "setup.ts",
        line: 4,
        message: expect.stringContaining("execSync"),
        excerpt: expect.stringContaining("fork("),
      },
    ]);
  });

  test("declines a file that mixes a rewritable invocation with a fork() call", () => {
    const source = `import { execSync, fork } from "node:child_process";

execSync("node seed/exec.mjs --truncate");
const child = fork("seed/exec.mjs", [], { stdio: "inherit" });
`;

    // Rewriting only the execSync line would leave the fork call stale while
    // marking the file as migrated, hiding it from the residual warning path.
    expect(transform(source, "setup.ts")).toBeNull();
    expect(reviewFindings(source, "setup.ts", "setup.ts")).toMatchObject([
      { line: 4, excerpt: expect.stringContaining("fork(") },
    ]);
  });

  test("ignores fork() calls unrelated to the seed runner", () => {
    const source = `import { fork } from "node:child_process";\nfork("tools/worker.mjs");\n`;

    expect(reviewFindings(source, "setup.ts", "setup.ts")).toEqual([]);
  });

  test("reports a fork() call whose runner path sits on a later line", () => {
    const source = `import { fork } from "node:child_process";
const child = fork(
  "seed/exec.mjs",
  [],
);
`;

    expect(transform(source, "setup.ts")).toBeNull();
    expect(reviewFindings(source, "setup.ts", "setup.ts")).toMatchObject([
      { line: 2, excerpt: expect.stringContaining("fork(") },
    ]);
  });

  test("reports only the seed runner fork when the file forks other scripts too", () => {
    const source = `import { fork } from "node:child_process";
fork("seed/exec.mjs");
fork("tools/worker.mjs");
`;

    expect(reviewFindings(source, "setup.ts", "setup.ts")).toMatchObject([
      { line: 2, excerpt: expect.stringContaining("seed/exec.mjs") },
    ]);
  });

  test("reports nothing once the seed runner call is migrated", () => {
    const source = `import { execSync } from "node:child_process";\nexecSync("pnpm tailor seed apply", { stdio: "inherit" });\n`;

    expect(transform(source, "setup.ts")).toBeNull();
    expect(reviewFindings(source, "setup.ts", "setup.ts")).toEqual([]);
  });

  test("reports nothing for non-source files", () => {
    expect(reviewFindings(FORK_SETUP, "notes.md", "notes.md")).toEqual([]);
  });

  test("rewrites execSync invocations through the package runner", () => {
    const source = "execSync(`node seed/exec.mjs --skip-idp -m ${name}`);\n";

    expect(transform(source, "setup.ts")).toBe(
      "execSync(`pnpm tailor seed apply --skip-idp -m ${name}`);\n",
    );
  });

  test("carries node env-file flags over to the CLI flag form", () => {
    const source = "node --env-file-if-exists=.env seed/exec.mjs --truncate --yes\n";

    expect(transform(source, "seed.sh")).toBe(
      "tailor seed apply --env-file-if-exists .env --truncate --yes\n",
    );
  });

  test("selects the validate subcommand from the runner's positional argument", () => {
    expect(transform("node ./seed/exec.mjs validate\n", "seed.sh")).toBe("tailor seed validate\n");
  });

  test("leaves unrelated exec.mjs scripts untouched", () => {
    expect(transform("node tools/exec.mjs --flag\n", "run.sh")).toBeNull();
    expect(transform("node exec.mjs\n", "run.sh")).toBeNull();
    expect(transform("nodemon seed/exec.mjs\n", "run.sh")).toBeNull();
  });
});
