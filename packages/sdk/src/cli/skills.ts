#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "pathe";
import { logger } from "./shared/logger";

logger.warn(
  "`tailor-sdk-skills` is deprecated and will be removed in v2. Use `tailor-sdk skills install` instead.",
);

const here = dirname(fileURLToPath(import.meta.url));
const mainCli = resolve(here, "index.mjs");

const child = spawn(process.execPath, [mainCli, "skills", "install", ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
