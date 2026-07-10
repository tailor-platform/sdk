import { get } from "@tailor-platform/sdk/runtime/aigateway";
import { get as getAgain } from "@tailor-platform/sdk/runtime/aigateway";

const first = await get("main");
const second = await getAgain("other");
