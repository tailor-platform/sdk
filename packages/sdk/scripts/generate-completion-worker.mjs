#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = resolve(packageRoot, "dist/cli/index.mjs");

const workers = [
  {
    shell: "zsh",
    outputPath: resolve(packageRoot, "dist/completion/zsh-worker.zsh"),
  },
];

for (const worker of workers) {
  mkdirSync(dirname(worker.outputPath), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [cliPath, "__refresh-completion", worker.shell, worker.outputPath, "--static", "--worker"],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        TAILOR_SDK_BIN: cliPath,
      },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const size = statSync(worker.outputPath).size;
  if (size === 0) {
    throw new Error(`Generated empty completion worker: ${worker.outputPath}`);
  }

  console.log(
    `Generated completion worker: ${relative(packageRoot, worker.outputPath)} (${size} bytes)`,
  );
}
