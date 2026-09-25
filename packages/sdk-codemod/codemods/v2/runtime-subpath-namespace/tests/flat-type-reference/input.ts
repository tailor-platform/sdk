import { Client as IdpClient } from "@tailor-platform/sdk/runtime/idp";

let client: IdpClient;
client = new IdpClient({ namespace: "default" });
