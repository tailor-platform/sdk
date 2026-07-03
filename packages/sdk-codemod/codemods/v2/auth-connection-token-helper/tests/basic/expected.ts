import { authconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  const token = await authconnection.getConnectionToken("google");
  return token;
}
