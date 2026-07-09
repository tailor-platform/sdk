import type { ClientConfig } from "@tailor-platform/sdk/runtime/idp";
import { idp } from "@tailor-platform/sdk/runtime/idp";

const config: ClientConfig = { namespace: "default" };
type ClientRef = idp.Client;
const client = new idp.Client(config);
