import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

{
  using auth = createClient();
  auth.getConnectionToken("github");
}
