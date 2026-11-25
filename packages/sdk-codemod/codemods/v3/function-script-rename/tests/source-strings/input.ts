import { execSync } from "node:child_process";

export function runFix(): void {
  execSync(`tailor function script scripts/fix.ts --arg '{"a":1}'`, { stdio: "inherit" });
}
