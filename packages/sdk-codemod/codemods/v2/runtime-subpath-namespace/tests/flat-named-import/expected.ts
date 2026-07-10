import { aigateway, type GetAIGatewayResult } from "@tailor-platform/sdk/runtime/aigateway";

const result: Promise<GetAIGatewayResult> = aigateway.get("main");
