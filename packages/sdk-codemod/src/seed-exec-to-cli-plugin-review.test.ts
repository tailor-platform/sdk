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

  test("carries over env-file flags written in the space-separated form", () => {
    expect(transform("node --env-file .env seed/exec.mjs --truncate\n", "seed.sh")).toBe(
      "tailor seed apply --env-file .env --truncate\n",
    );
    expect(transform("node --env-file-if-exists .env seed/exec.mjs\n", "seed.sh")).toBe(
      "tailor seed apply --env-file-if-exists .env\n",
    );
  });

  test("carries over every env-file flag in one invocation", () => {
    expect(
      transform("node --env-file=.env --env-file-if-exists=.env.local seed/exec.mjs\n", "seed.sh"),
    ).toBe("tailor seed apply --env-file .env --env-file-if-exists .env.local\n");
  });

  test("consumes loader flag values instead of reading them as the runner path", () => {
    expect(transform("node --import tsx seed/exec.mjs validate\n", "seed.sh")).toBe(
      "tailor seed validate\n",
    );
    expect(transform("node -r dotenv/config seed/exec.mjs\n", "seed.sh")).toBe(
      "tailor seed apply\n",
    );
  });

  test("rewrites runners under a distPath that is not named after seeding", () => {
    // seedPlugin's distPath is a required, arbitrary option, so the directory
    // name cannot be used to recognise the generated runner.
    expect(transform("node generated/exec.mjs --yes\n", "seed.sh")).toBe(
      "tailor seed apply --yes\n",
    );
    expect(transform("node db/exec.mjs\n", "seed.sh")).toBe("tailor seed apply\n");
  });

  test("does not span lines when tokens are separate list items", () => {
    // A YAML sequence or markdown bullet puts each token on its own line;
    // matching across the newline would delete the intervening items.
    const yaml = "command:\n  - node\n  - --no-warnings\n  - seed/exec.mjs\n  - --yes\n";

    expect(transform(yaml, "ci.yml")).toBeNull();
    expect(transform("- node\n- seed/exec.mjs\n", "docs.md")).toBeNull();
  });

  test("treats a flag-shaped value as a value, not a carried-over flag", () => {
    expect(transform("node --require --env-file=.evil seed/exec.mjs\n", "run.sh")).toBe(
      "tailor seed apply\n",
    );
  });

  test("does not prefix a package runner that is already present", () => {
    expect(transform('execSync("pnpm node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("pnpm tailor seed apply");\n',
    );
  });

  test("still prefixes when a runner name is only a token suffix", () => {
    expect(transform('execSync("mypnpm node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("mypnpm pnpm tailor seed apply");\n',
    );
  });

  test("keeps validate a subcommand only when it stands alone", () => {
    expect(transform("node seed/exec.mjs validate=x\n", "run.sh")).toBe(
      "tailor seed apply validate=x\n",
    );
  });

  test("matches a long boolean flag run without backtracking", () => {
    // Overlapping flag alternatives let the engine re-split every token, so a
    // non-matching runner path ahead used to backtrack exponentially.
    const flags = Array.from({ length: 40 }, (_, i) => `--flag${i}`).join(" ");
    const source = `node ${flags} other/script.mjs\nnode seed/exec.mjs\n`;

    const started = performance.now();
    expect(transform(source, "run.sh")).toBe(`node ${flags} other/script.mjs\ntailor seed apply\n`);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("selects the validate subcommand with a trailing data path", () => {
    expect(transform("node seed/exec.mjs validate data/seed\n", "seed.sh")).toBe(
      "tailor seed validate data/seed\n",
    );
  });

  test("selects the validate subcommand from the runner's positional argument", () => {
    expect(transform("node ./seed/exec.mjs validate\n", "seed.sh")).toBe("tailor seed validate\n");
  });

  test("leaves invocations that are not the generated runner untouched", () => {
    // A top-level exec.mjs is a project's own script: the generated runner
    // always lives under the seedPlugin distPath directory.
    expect(transform("node exec.mjs\n", "run.sh")).toBeNull();
    expect(transform("nodemon seed/exec.mjs\n", "run.sh")).toBeNull();
    expect(transform("./seed/exec.mjs\n", "run.sh")).toBeNull();
    expect(transform("The generated seed/exec.mjs file\n", "README.md")).toBeNull();
  });
});
