import { auth } from "../tailor.config";
import { type authconnection, workflow } from "@tailor-platform/sdk/runtime";

export async function run() {
  await workflow.wait("ready");
  return auth.getConnectionToken("google");
}
