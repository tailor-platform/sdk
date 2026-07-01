import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

switch (kind) {
  case "github":
    const auth = createClient();
    auth.getConnectionToken("github");
}
