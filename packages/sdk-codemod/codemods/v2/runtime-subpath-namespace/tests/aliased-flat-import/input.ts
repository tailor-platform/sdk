import { Client as IdpClient } from "@tailor-platform/sdk/runtime/idp";

const ClientRef = IdpClient;
const client = new IdpClient({ namespace: "default" });
