/**
 * AI Gateway utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.aigateway` runtime API.
 * At runtime this delegates to `globalThis.tailor.aigateway`. Use `mockAigateway`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * `name` is narrowed to the AI Gateway names defined via `defineAIGateway()`
 * once `tailor.d.ts` has been generated (via `tailor deploy`/`generate`).
 * @example
 * import { aigateway } from "@tailor-platform/sdk/runtime";
 *
 * const { url } = await aigateway.get("my-aigateway");
 */

// Import from the public entry (not `#/configure/types/aigateway-name`) so this d.ts
// references `@tailor-platform/sdk` externally instead of inlining the registry — the
// same generated `declare module "@tailor-platform/sdk"` that narrows
// `authconnection.getConnectionToken` then also narrows this entry.
import type { AIGatewayName } from "@tailor-platform/sdk";

/** Result of {@link TailorAigatewayAPI.get}. */
export interface GetAIGatewayResult {
  /** The platform-assigned URL of the AI Gateway. */
  url: string;
}

/**
 * Platform API surface for `tailor.aigateway`. Describes the shape the
 * platform runtime injects on `globalThis.tailor.aigateway`.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module so callers can either `import * as aigateway from
 * "@tailor-platform/sdk/runtime/aigateway"` or pick individual methods.
 */
export interface TailorAigatewayAPI {
  /**
   * Resolves an AI Gateway defined in the caller's own workspace.
   * @param name - AI Gateway name, as passed to `defineAIGateway()`
   * @returns The resolved AI Gateway's platform-assigned URL
   */
  get(name: AIGatewayName): Promise<GetAIGatewayResult>;
}

const api = (): TailorAigatewayAPI =>
  (globalThis as { tailor: { aigateway: TailorAigatewayAPI } }).tailor.aigateway;

/**
 * See {@link TailorAigatewayAPI.get}.
 * @param args - Forwarded to {@link TailorAigatewayAPI.get}
 * @returns The resolved AI Gateway's platform-assigned URL
 */
export const get: TailorAigatewayAPI["get"] = (...args) => api().get(...args);
