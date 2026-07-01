import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

namespace Clients {
  export const auth = createClient();

  export function run() {
    return auth.getConnectionToken("github");
  }
}
