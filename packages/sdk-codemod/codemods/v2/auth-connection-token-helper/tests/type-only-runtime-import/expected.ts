import { authconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  return authconnection.getConnectionToken("google");
}
