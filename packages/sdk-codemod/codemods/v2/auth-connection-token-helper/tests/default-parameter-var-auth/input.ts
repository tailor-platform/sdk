import { auth } from "../tailor.config";

export function run(token = auth.getConnectionToken("google")) {
  var auth = createClient();
  return token;
}
