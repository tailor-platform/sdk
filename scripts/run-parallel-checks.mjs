#!/usr/bin/env node

// pnpm 12's `pnpm run "/pattern/" --no-bail` kills sibling matched scripts
// before they finish (pnpm/pnpm#14718), so lanes are spawned directly here.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const prefix = process.argv[2];
if (!prefix) {
  console.error("usage: run-parallel-checks.mjs <script-name-prefix>");
  process.exit(1);
}

const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
const lanes = Object.keys(scripts).filter((name) => name.startsWith(prefix));

const results = await Promise.all(
  lanes.map(
    (name) =>
      new Promise((resolve) => {
        const child =
          process.platform === "win32"
            ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `pnpm run ${name}`], {
                stdio: "inherit",
              })
            : spawn("pnpm", ["run", name], { stdio: "inherit" });
        child.on("close", (code) => resolve({ name, code }));
      }),
  ),
);

const failed = results.filter(({ code }) => code !== 0);
for (const { name } of failed) {
  console.error(`${name}: Failed`);
}
process.exit(failed.length > 0 ? 1 : 0);
