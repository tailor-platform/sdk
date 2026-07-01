import { authconnection } from "@tailor-platform/sdk/runtime";

export function run(token = authconnection.getConnectionToken("google")) {
  var auth = createClient();
  return token;
}
