import { authconnection } from "@tailor-platform/sdk/runtime";

export async function run(token = authconnection) {
  return authconnection.getConnectionToken("google");
}
