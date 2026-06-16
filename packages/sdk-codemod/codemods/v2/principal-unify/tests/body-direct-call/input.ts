import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolver";

const customUser = {
  id: "user-2",
  type: "user",
  workspaceId: "workspace-1",
  attributes: {},
  attributeList: [],
};

export async function run() {
  return await resolver.body({
    input: { id: "user-1" },
    user: unauthenticatedTailorUser,
    env: {},
  });
}

export async function runAsCustomUser() {
  return await resolver.body({
    input: { id: "user-2" },
    user: customUser,
    env: {},
  });
}

export async function runWithFactory() {
  return await resolver.body({
    input: { id: "user-2" },
    user: makeUser(unauthenticatedTailorUser),
    env: {},
  });
}

function makeUser(fallback = customUser) {
  return fallback;
}
