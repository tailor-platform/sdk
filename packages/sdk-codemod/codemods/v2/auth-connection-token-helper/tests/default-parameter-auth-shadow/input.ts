import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

export function run(auth = createClient()) {
  return auth.getConnectionToken("github");
}
