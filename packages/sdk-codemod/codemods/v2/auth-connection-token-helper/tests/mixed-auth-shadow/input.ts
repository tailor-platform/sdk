import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

export async function run(auth: { getConnectionToken(name: string): Promise<string> }) {
  return auth.getConnectionToken("github");
}
