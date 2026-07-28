import { execSync } from "node:child_process";

import { machineUsers } from "./fixtures";

export function seed(): void {
  execSync(`npx tailor seed apply --skip-idp -m ${machineUsers[0].name}`, {
    stdio: "inherit",
  });
}
