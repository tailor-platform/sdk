import { auth } from "../tailor.config";

export async function run(token = authconnection) {
  return auth.getConnectionToken("google");
}
