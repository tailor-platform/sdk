import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

switch (kind) {
  case "github":
    const auth = createClient();
    auth.getConnectionToken("github");
}
