import { workflow } from "@tailor-platform/sdk/runtime";
import { auth } from "../tailor.config";

export async function run() {
  await workflow.wait("ready");
  return auth.getConnectionToken("google");
}
