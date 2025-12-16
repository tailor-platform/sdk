import { execSync } from "node:child_process";
import { join } from "node:path";
import { show, machineUserToken } from "@tailor-platform/sdk/cli";

const configDir = import.meta.dirname;
const configPath = join(configDir, "../tailor.config.ts");

console.log("Starting seed data generation...");

const appInfo = await show({ configPath });
const endpoint = `${appInfo.url}/query`;

const tokenInfo = await machineUserToken({ name: "manager-machine-user", configPath });
const headers = JSON.stringify({ Authorization: `Bearer ${tokenInfo.accessToken}` });

const headersArg = process.platform === "win32"
  ? `"${headers.replace(/"/g, '\\"')}"`
  : `'${headers}'`;

const cmd = `npx gql-ingest -c "${configDir}" -e "${endpoint}" --headers ${headersArg}`;
console.log("Running:", cmd);

try {
  execSync(cmd, { stdio: "inherit" });
} catch (error) {
  console.error("Seed failed with exit code:", error.status);
  process.exit(error.status ?? 1);
}
