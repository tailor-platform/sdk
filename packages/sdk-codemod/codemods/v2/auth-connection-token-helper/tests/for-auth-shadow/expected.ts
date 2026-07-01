import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

export function run() {
  for (let auth = createClient(); ready; tick()) {
    auth.getConnectionToken("github");
  }
}
