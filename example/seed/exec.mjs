import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, { encoding: "utf-8" }).trim();
}

const showOutput = JSON.parse(run("pnpm exec tailor-sdk show -f json"));
const endpoint = `${showOutput.url}/query`;

const tokenOutput = JSON.parse(run("pnpm exec tailor-sdk machineuser token manager-machine-user -f json"));
const headers = JSON.stringify({ Authorization: `Bearer ${tokenOutput.access_token}` });

execSync(`gql-ingest -c seed -e "${endpoint}" --headers '${headers}'`, { stdio: "inherit" });
