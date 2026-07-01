import { auth } from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export async function run(authconnection: { getConnectionToken(name: string): Promise<string> }) {
  return auth.getConnectionToken("google");
}
