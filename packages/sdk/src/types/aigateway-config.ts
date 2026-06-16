import type { AIGatewayInput } from "./aigateway.generated";

declare const aiGatewayDefinitionBrand: unique symbol;
export type AIGatewayDefinitionBrand = {
  readonly [aiGatewayDefinitionBrand]: true;
};

/** Type accepted by `AppConfig.aiGateways`. Only values returned by `defineAIGateway()` satisfy this. */
export type AIGatewayConfig = AIGatewayInput & AIGatewayDefinitionBrand;
