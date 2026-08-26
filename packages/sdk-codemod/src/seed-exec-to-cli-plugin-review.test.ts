import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import transform, {
  reviewFindings,
} from "../codemods/v2/seed-exec-to-cli-plugin/scripts/transform";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

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

  test("rewrites a seed invocation when the same file only forks an unrelated script", () => {
    const source = `import { execSync, fork } from "node:child_process";

execSync("node seed/exec.mjs --truncate");
fork("tools/worker.mjs");
`;

    expect(transform(source, "setup.ts")).toBe(`import { execSync, fork } from "node:child_process";

execSync("npx @tailor-platform/sdk seed apply --truncate");
fork("tools/worker.mjs");
`);
    expect(reviewFindings(source, "setup.ts", "setup.ts")).toEqual([]);
  });

  test("declines a mixed file when the forked seed runner path is assembled dynamically", () => {
    const source = `import { execSync, fork } from "node:child_process";
import * as path from "node:path";

execSync("node seed/exec.mjs --truncate");
fork(path.join(distPath, "exec.mjs"));
`;

    expect(transform(source, "setup.ts")).toBeNull();
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
      "execSync(`npx @tailor-platform/sdk seed apply --skip-idp -m ${name}`);\n",
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

  test("rewrites shell commands split with a line continuation", () => {
    const source = "node --env-file=.env \\\n  seed/exec.mjs --yes\n";
    const windowsSource = "node --env-file=.env \\\r\n  seed/exec.mjs --yes\r\n";

    expect(transform(source, "seed.sh")).toBe("tailor seed apply --env-file .env --yes\n");
    expect(transform(windowsSource, "seed.sh")).toBe("tailor seed apply --env-file .env --yes\r\n");
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

  test("does not prefix compound package runner commands", () => {
    expect(transform('execSync("pnpm exec node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("pnpm exec tailor seed apply");\n',
    );
    expect(transform('execSync("npm exec node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("npm exec @tailor-platform/sdk seed apply");\n',
    );
    expect(transform('execSync("yarn dlx node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("yarn dlx @tailor-platform/sdk seed apply");\n',
    );
    expect(transform('execSync("bunx node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("bunx @tailor-platform/sdk seed apply");\n',
    );
  });

  test("names the package when the retained runner installs missing names", () => {
    expect(transform("npx node seed/exec.mjs\n", "seed.sh")).toBe(
      "npx @tailor-platform/sdk seed apply\n",
    );
    expect(transform("pnpm exec node seed/exec.mjs\n", "seed.sh")).toBe(
      "pnpm exec tailor seed apply\n",
    );
  });

  test("decides the runner prefix per invocation, not per file", () => {
    const source = 'execSync("pnpm node seed/exec.mjs");\nexecSync("node seed/exec.mjs");\n';

    expect(transform(source, "setup.ts")).toBe(
      'execSync("pnpm tailor seed apply");\nexecSync("npx @tailor-platform/sdk seed apply");\n',
    );
  });

  test("still prefixes when a runner name is only a token suffix", () => {
    expect(transform('execSync("mypnpm node seed/exec.mjs");\n', "setup.ts")).toBe(
      'execSync("mypnpm npx @tailor-platform/sdk seed apply");\n',
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

  test("uses the package-runner form in the manual migration guidance", () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/seed-exec-to-cli-plugin");

    expect(codemod?.prompt).toContain(
      'execSync("npx @tailor-platform/sdk seed apply", { env, stdio: "inherit" })',
    );
    expect(reviewFindings(FORK_SETUP, "setup.ts", "setup.ts")[0]?.message).toContain(
      'execSync("npx @tailor-platform/sdk seed apply")',
    );
  });

  test("runs the transform for every supported source and shell extension", async () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/seed-exec-to-cli-plugin");
    expect(codemod).toBeDefined();
    if (!codemod) throw new Error("seed exec codemod is not registered");

    const scriptPath = path.resolve(
      __dirname,
      "../codemods/v2/seed-exec-to-cli-plugin/scripts/transform.ts",
    );
    const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "seed-exec-patterns-"));
    const sourceFiles = [
      "setup.ts",
      "setup.tsx",
      "global-setup.mts",
      "setup.cts",
      "setup.js",
      "setup.jsx",
      "setup.mjs",
      "setup.cjs",
    ];
    const shellFiles = ["seed.sh", "seed.bash", "seed.zsh"];

    try {
      await Promise.all([
        ...sourceFiles.map((file) =>
          fs.promises.writeFile(
            path.join(projectDir, file),
            'execSync("node seed/exec.mjs --yes");\n',
            "utf-8",
          ),
        ),
        ...shellFiles.map((file) =>
          fs.promises.writeFile(path.join(projectDir, file), "node seed/exec.mjs --yes\n", "utf-8"),
        ),
      ]);

      const result = await runCodemods([{ codemod, scriptPath }], projectDir, false);

      expect(result.filesModified.map((file) => path.basename(file)).toSorted()).toEqual(
        [...sourceFiles, ...shellFiles].toSorted(),
      );
      await Promise.all(
        sourceFiles.map(async (file) => {
          await expect(fs.promises.readFile(path.join(projectDir, file), "utf-8")).resolves.toBe(
            'execSync("npx @tailor-platform/sdk seed apply --yes");\n',
          );
        }),
      );
      await Promise.all(
        shellFiles.map(async (file) => {
          await expect(fs.promises.readFile(path.join(projectDir, file), "utf-8")).resolves.toBe(
            "tailor seed apply --yes\n",
          );
        }),
      );
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    }
  });

  test("surfaces shell-variable runner paths without flagging bare exec.mjs text", async () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/seed-exec-to-cli-plugin");
    expect(codemod).toBeDefined();
    if (!codemod) throw new Error("seed exec codemod is not registered");

    const scriptPath = path.resolve(
      __dirname,
      "../codemods/v2/seed-exec-to-cli-plugin/scripts/transform.ts",
    );
    const projectDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "seed-exec-variable-paths-"),
    );
    const suspiciousFiles = ["seed.sh", "ci.yml", "README.md"];

    try {
      await Promise.all([
        ...suspiciousFiles.map((file) =>
          fs.promises.writeFile(
            path.join(projectDir, file),
            'node "${SEED_DIST}/exec.mjs" --yes\n',
            "utf-8",
          ),
        ),
        fs.promises.writeFile(
          path.join(projectDir, "notes.md"),
          "The generated exec.mjs file\nnode exec.mjs\n",
          "utf-8",
        ),
      ]);

      const result = await runCodemods([{ codemod, scriptPath }], projectDir, false);

      expect(result.filesModified).toEqual([]);
      expect(result.llmReviews).toMatchObject([
        {
          codemodId: "v2/seed-exec-to-cli-plugin",
          files: suspiciousFiles.toSorted(),
        },
      ]);
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    }
  });
});
