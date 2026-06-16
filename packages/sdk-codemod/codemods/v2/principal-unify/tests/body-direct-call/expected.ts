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
    caller: null,
    invoker: null,
    env: {},
  });
}

export async function runAsCustomUser() {
  return await resolver.body({
    input: { id: "user-2" },
    caller: customUser,
    invoker: customUser,
    env: {},
  });
}

export async function runWithFactory() {
  return await resolver.body({
    input: { id: "user-2" },
    ...((user) => ({ caller: user, invoker: user }))(makeUser(null)),
    env: {},
  });
}

function makeUser(fallback = customUser) {
  return fallback;
}
