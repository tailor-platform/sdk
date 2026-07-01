import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

export const run = input => {
  if (ready) var auth = createClient(input);
  return auth.getConnectionToken("github");
};
