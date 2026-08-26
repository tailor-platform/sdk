import { execSync } from "node:child_process";

export function scaffoldStaging(): void {
  execSync(`tailor setup branch --name my-app-stg --target main`, { stdio: "inherit" });
  execSync("tailor setup tag --name my-app-prod --branch main", { stdio: "inherit" });
}
