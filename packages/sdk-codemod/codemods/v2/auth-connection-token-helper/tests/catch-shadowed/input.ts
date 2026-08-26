import { auth } from "../tailor.config";

export async function run() {
  try {
    return "ok";
  } catch (auth) {
    return auth.getConnectionToken("google");
  }
}
