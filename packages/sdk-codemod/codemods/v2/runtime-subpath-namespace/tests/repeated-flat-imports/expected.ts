import { aigateway } from "@tailor-platform/sdk/runtime/aigateway";

const first = await aigateway.get("main");
const second = await aigateway.get("other");
