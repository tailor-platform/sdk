import { db } from "../tailor.config";
import { authconnection as runtimeAuthconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  const token = await runtimeAuthconnection.getConnectionToken("google");
  return { token, db };
}
