import { execSync } from "node:child_process";
import { show, machineUserToken } from "@tailor-platform/sdk/cli";

console.log("Starting seed data generation...");

const appInfo = await show();
const endpoint = `${appInfo.url}/query`;

const tokenInfo = await machineUserToken({ name: "manager-machine-user" });
const headers = JSON.stringify({ Authorization: `Bearer ${tokenInfo.accessToken}` });

// Build command with platform-specific quoting
const headersArg = process.platform === "win32"
  ? `"${headers.replace(/"/g, '\\"')}"`  // Windows: escape " as \"
  : `'${headers}'`;                        // Unix: use single quotes

const cmd = `npx gql-ingest -c seed -e "${endpoint}" --headers ${headersArg}`;
console.log("Running:", cmd);

try {
  execSync(cmd, { stdio: "inherit" });
} catch (error) {
  console.error("Seed failed with exit code:", error.status);
  process.exit(error.status ?? 1);
}
