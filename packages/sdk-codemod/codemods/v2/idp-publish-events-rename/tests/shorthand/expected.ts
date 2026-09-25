import { defineIdp } from "@tailor-platform/sdk";

export function build(clients: string[], publishUserEvents: boolean) {
  return defineIdp("my-idp", { clients, publishEvents: publishUserEvents });
}
