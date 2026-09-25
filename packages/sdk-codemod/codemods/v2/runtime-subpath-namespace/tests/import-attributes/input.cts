import type { Client } from "@tailor-platform/sdk/runtime/idp" with { "resolution-mode": "import" };
import { get } from "@tailor-platform/sdk/runtime/aigateway" assert { type: "json" };

type ClientRef = Client;
const gateway = get("main");
