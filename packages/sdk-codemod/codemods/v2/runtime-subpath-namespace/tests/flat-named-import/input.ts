import { get, type GetAIGatewayResult } from "@tailor-platform/sdk/runtime/aigateway";

const result: Promise<GetAIGatewayResult> = get("main");
