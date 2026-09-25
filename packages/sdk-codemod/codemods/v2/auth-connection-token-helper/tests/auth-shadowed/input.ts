import { auth } from "../tailor.config";

export async function run(auth: { getConnectionToken(name: string): Promise<string> }) {
  return auth.getConnectionToken("google");
}
