import { auth } from "../tailor.config";

const authconnection = createClient();

export async function run() {
  return auth.getConnectionToken("google");
}
