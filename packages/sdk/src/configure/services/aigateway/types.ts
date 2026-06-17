// AI Gateway configuration input types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { AIGatewayInput } from "@/types/aigateway.generated";

declare const aiGatewayDefinitionBrand: unique symbol;
export type AIGatewayDefinitionBrand = {
  readonly [aiGatewayDefinitionBrand]: true;
};

/** Type accepted by `AppConfig.aiGateways`. Only values returned by `defineAIGateway()` satisfy this. */
export type AIGatewayConfig = AIGatewayInput & AIGatewayDefinitionBrand;
