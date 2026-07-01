import { auth as mainAuth, db } from "../tailor.config";
import { authconnection as runtimeAuthconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  const token = await mainAuth.getConnectionToken("google");
  return { token, db };
}
