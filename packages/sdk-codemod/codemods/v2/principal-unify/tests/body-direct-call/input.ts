import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolver";

export async function run() {
  return await resolver.body({
    input: { id: "user-1" },
    user: unauthenticatedTailorUser,
    env: {},
  });
}

