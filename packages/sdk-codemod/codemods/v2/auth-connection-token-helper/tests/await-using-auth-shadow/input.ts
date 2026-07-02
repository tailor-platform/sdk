import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

{
  await using auth = createClient();
  auth.getConnectionToken("github");
}
