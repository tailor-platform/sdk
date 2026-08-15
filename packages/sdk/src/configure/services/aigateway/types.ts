// AI Gateway configuration input types.
//
// This is a pure type module: type declarations only, no valibot/schema
// references, importable type-only from any layer.
import type { AuthNamespaceName } from "#/configure/types/auth-namespace-name";
import type { AIGatewayInput } from "#/types/aigateway.generated";

declare const aiGatewayDefinitionBrand: unique symbol;
export type AIGatewayDefinitionBrand = {
  readonly [aiGatewayDefinitionBrand]: true;
};

/** AI Gateway configuration accepted by `defineAIGateway()`. */
export type AIGatewayServiceInput = Omit<AIGatewayInput, "authNamespace"> & {
  authNamespace?: AuthNamespaceName;
};

/** Type accepted by `AppConfig.aiGateways`. Only values returned by `defineAIGateway()` satisfy this. */
export type AIGatewayConfig = AIGatewayInput & AIGatewayDefinitionBrand;
