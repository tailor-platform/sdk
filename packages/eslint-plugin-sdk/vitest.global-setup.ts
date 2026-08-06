import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to build the plugin that rule tests lint fixtures with.");
  }
}
