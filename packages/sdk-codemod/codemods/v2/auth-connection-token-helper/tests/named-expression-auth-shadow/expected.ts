import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");

const fn = function auth() {
  return auth.getConnectionToken("github");
};

const Client = class auth {
  run() {
    return auth.getConnectionToken("github");
  }
};
