import { Client as IdpClient } from "@tailor-platform/sdk/runtime/idp";
import type { Client } from "@tailor-platform/sdk/runtime/idp";

type ClientRef = Client;
const client = new IdpClient({ namespace: "default" });
