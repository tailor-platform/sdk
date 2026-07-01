import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

export function run() {
  if (ready) var auth = createClient();
  return auth.getConnectionToken("github");
}
