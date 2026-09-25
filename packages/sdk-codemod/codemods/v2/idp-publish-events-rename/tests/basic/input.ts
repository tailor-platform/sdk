import { defineIdp } from "@tailor-platform/sdk";

export const idp = defineIdp("my-idp", {
  clients: ["my-client"],
  publishUserEvents: true,
});
