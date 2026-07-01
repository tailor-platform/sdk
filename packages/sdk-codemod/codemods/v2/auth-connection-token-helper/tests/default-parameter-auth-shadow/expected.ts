import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

export function run(auth = createClient()) {
  return auth.getConnectionToken("github");
}
