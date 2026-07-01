import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

export const run = input => {
  if (ready) var auth = createClient(input);
  return auth.getConnectionToken("github");
};
