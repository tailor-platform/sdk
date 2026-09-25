import * as sdk from "@tailor-platform/sdk";

export const idp = sdk.defineIdp("my-idp", { clients: ["c"], publishUserEvents: true });
