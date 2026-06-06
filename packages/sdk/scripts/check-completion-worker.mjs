#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = resolve(packageRoot, "dist/cli/index.mjs");

const workers = [
  {
    shell: "zsh",
    outputPath: resolve(packageRoot, "dist/completion/zsh-worker.zsh"),
    requiredHeaders: [
      "# politty-completion-version: 1",
      "# program: tailor-sdk",
      "# shell: zsh",
      "# politty-completion-mode: worker",
      "# politty-completion-worker: true",
    ],
  },
];

for (const worker of workers) {
  if (!existsSync(worker.outputPath)) {
    throw new Error(
      `Missing bundled completion worker: ${relative(packageRoot, worker.outputPath)}. Run pnpm -C packages/sdk build.`,
    );
  }

  const size = statSync(worker.outputPath).size;
  if (size === 0) {
    throw new Error(`Bundled completion worker is empty: ${worker.outputPath}`);
  }

  const head = readFileSync(worker.outputPath, "utf8").split("\n").slice(0, 24).join("\n");
  for (const header of worker.requiredHeaders) {
    if (!head.includes(header)) {
      throw new Error(
        `Bundled completion worker ${relative(packageRoot, worker.outputPath)} is missing header: ${header}`,
      );
    }
  }

  const result = spawnSync(process.execPath, [cliPath, "__completion-worker-path", worker.shell], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TAILOR_SDK_BIN: cliPath,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve bundled completion worker for ${worker.shell}: ${result.stderr.trim()}`,
    );
  }

  const reportedPath = result.stdout.trim();
  if (!reportedPath) {
    throw new Error(`Bundled completion worker path for ${worker.shell} was empty.`);
  }

  if (realpathSync(reportedPath) !== realpathSync(worker.outputPath)) {
    throw new Error(
      `Bundled completion worker path mismatch for ${worker.shell}: expected ${worker.outputPath}, got ${reportedPath}`,
    );
  }

  console.log(
    `Verified completion worker: ${relative(packageRoot, worker.outputPath)} (${size} bytes)`,
  );
}
