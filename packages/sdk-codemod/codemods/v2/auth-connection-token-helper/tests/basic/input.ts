import { auth } from "../tailor.config";

export async function run() {
  const token = await auth.getConnectionToken("google");
  return token;
}
