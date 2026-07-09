import type { idp } from "@tailor-platform/sdk/runtime/idp" with { "resolution-mode": "import" };
import { aigateway } from "@tailor-platform/sdk/runtime/aigateway" assert { type: "json" };

type ClientRef = idp.Client;
const gateway = aigateway.get("main");
