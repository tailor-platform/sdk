import {
  auth,
  other,
} from "../tailor.config";

export async function run() {
  return {
    token: await auth.getConnectionToken("google"),
    other,
  };
}
