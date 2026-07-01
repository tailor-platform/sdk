import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

export function run() {
  for (let auth = createClient(); ready; tick()) {
    auth.getConnectionToken("github");
  }
}
