/* eslint-disable @typescript-eslint/no-explicit-any */

import { Resolver, RESOLVER_SYMBOL } from "../resolver";
import { measure } from "../../../performance";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const jiti = createJiti(__filename, {
  interopDefault: true,
});

export class ResolverLoader {
  @measure
  async load(resolverFilePath: string): Promise<InstanceType<typeof Resolver>> {
    const resolverModule = (await jiti.import(resolverFilePath)) as {
      default: any;
    };
    const resolver = resolverModule.default;

    // Use symbol-based identification for reliable detection
    if (!this.isResolver(resolver)) {
      throw new Error(
        `The provided module does not export a valid Resolver instance. path: ${resolverFilePath}`,
      );
    }

    return resolver;
  }

  private isResolver(
    obj: unknown,
  ): obj is Resolver<any, any, any, any, any, any> {
    // Primary check: Symbol-based identification
    if (obj === null || typeof obj !== "object") {
      return false;
    }

    // Check for the unique symbol
    if (!(RESOLVER_SYMBOL in obj) || (obj as any)[RESOLVER_SYMBOL] !== true) {
      return false;
    }

    // Secondary check: Verify essential properties and methods
    const resolver = obj as any;
    return (
      typeof resolver.name === "string" &&
      typeof resolver.queryType === "string" &&
      (resolver.queryType === "query" || resolver.queryType === "mutation") &&
      Array.isArray(resolver.steps) &&
      typeof resolver.toSDLMetadata === "function"
    );
  }
}
