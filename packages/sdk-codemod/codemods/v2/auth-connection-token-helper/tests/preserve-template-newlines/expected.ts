import { authconnection } from "@tailor-platform/sdk/runtime";

const body = `line 1


line 4`;

export async function run() {
  return authconnection.getConnectionToken("google") + body;
}
