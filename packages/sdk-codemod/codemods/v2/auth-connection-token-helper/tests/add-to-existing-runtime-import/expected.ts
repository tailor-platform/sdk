import { workflow, authconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  await workflow.wait("ready");
  return authconnection.getConnectionToken("google");
}
