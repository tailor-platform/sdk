import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

export async function run(auth: { getConnectionToken(name: string): Promise<string> }) {
  return auth.getConnectionToken("github");
}
