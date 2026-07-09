import { idp } from "@tailor-platform/sdk/runtime/idp";

type ClientRef = idp.Client;
const client = new idp.Client({ namespace: "default" });
