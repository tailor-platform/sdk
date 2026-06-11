import type { AIGatewayDefinitionBrand } from "@/types/aigateway-config";
import type { AIGatewayInput } from "@/types/aigateway.generated";
export type { AIGatewayConfig } from "@/types/aigateway-config";

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
    get url() {
      return `${name}:aigateway-url` as const;
    },
    get domain() {
      return `${name}:aigateway-domain` as const;
    },
  } as const satisfies AIGatewayInput & { readonly url: string; readonly domain: string };

  return result as typeof result & AIGatewayDefinitionBrand;
}
