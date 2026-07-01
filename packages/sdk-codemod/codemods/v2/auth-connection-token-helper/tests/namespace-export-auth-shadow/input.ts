import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

namespace Clients {
  export const auth = createClient();

  export function run() {
    return auth.getConnectionToken("github");
  }
}
