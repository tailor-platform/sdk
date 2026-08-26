import { createExecutor } from "@tailor-platform/sdk";

const actor = {
  userId: "domain-user",
  userType: "performer",
};

export const domainActor = {
  id: actor.userId,
  type: actor.userType,
};

export const onEvent = createExecutor({
  operation: {
    kind: "function",
    body: () => domainActor,
  },
});
