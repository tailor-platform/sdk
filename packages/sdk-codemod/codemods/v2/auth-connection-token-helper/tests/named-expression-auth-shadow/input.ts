import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

const fn = function auth() {
  return auth.getConnectionToken("github");
};

const Client = class auth {
  run() {
    return auth.getConnectionToken("github");
  }
};
