import { defineIdp } from "./local-idp";

export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents: true });
