import { defineIdp } from "@tailor-platform/sdk";

export const idp = defineIdp("my-idp", {
  clients: ["c"],
  userAuthPolicy: { publishUserEvents: true },
});
