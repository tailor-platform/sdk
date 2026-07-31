import { type authconnection } from "@tailor-platform/sdk/runtime";
import { auth } from "../tailor.config";

export async function run() {
  return auth.getConnectionToken("google");
}
