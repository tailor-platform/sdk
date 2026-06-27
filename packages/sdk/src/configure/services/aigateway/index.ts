import type { AIGatewayInput } from "#/types/aigateway.generated";
import type { AIGatewayDefinitionBrand } from "./types";
export type { AIGatewayConfig } from "./types";

/**
 * Define an AI Gateway configuration for the Tailor SDK.
 * @param name - AI Gateway name
 * @param config - AI Gateway configuration
 * @returns Defined AI Gateway
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineAIGateway(name: string, config: Omit<AIGatewayInput, "name">) {
  const result = {
    ...config,
    name,
  } as const satisfies AIGatewayInput;

  return result as typeof result & AIGatewayDefinitionBrand;
}
