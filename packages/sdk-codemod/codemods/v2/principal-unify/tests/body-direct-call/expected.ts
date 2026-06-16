import resolver from "./resolver";

export async function run() {
  return await resolver.body({
    input: { id: "user-1" },
    caller: null,
    invoker: null,
    env: {},
  });
}

