import { vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { AIGatewayName } from "@tailor-platform/sdk";

interface AigatewayCall {
  name: AIGatewayName;
}

/** Initial fixtures for an AI Gateway mock. */
export interface MockAigatewayOptions {
  /** AI Gateway URLs available when the mock is acquired. */
  urls?: Partial<Record<AIGatewayName, string>>;
}

// ---------------------------------------------------------------------------
// AI Gateway Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.aigateway`. Restored on dispose.
 * @param options - Initial AI Gateway URL fixtures
 * @returns Disposable AI Gateway mock control object
 * @example
 * ```typescript
 * import { mockAigateway } from "@tailor-platform/sdk/vitest";
 *
 * test("resolves an AI Gateway URL", async () => {
 *   using aigateway = mockAigateway({
 *     urls: { "my-aigateway": "https://my-aigateway.example.com" },
 *   });
 *   aigateway.setUrl("my-aigateway", "https://replacement.example.com");
 *   // …
 * });
 * ```
 */
export function mockAigateway(options: MockAigatewayOptions = {}) {
  const root = tailorRoot();
  const prev = root.aigateway;

  let urls: Partial<Record<AIGatewayName, string>> = { ...options.urls };

  async function defaultGet(name: AIGatewayName): Promise<{ url: string }> {
    const url = urls[name];
    if (url === undefined) {
      throw new Error(
        `No AI Gateway registered for "${name}". Acquire mockAigateway() and call setUrls(...).`,
      );
    }
    return { url };
  }

  const get = vi.fn(defaultGet);

  root.aigateway = { get };

  const facade = {
    /** The `get` `vi.fn`. */
    get,

    setUrls(value: Partial<Record<AIGatewayName, string>>): void {
      urls = value;
    },

    setUrl(name: AIGatewayName, url: string): void {
      urls[name] = url;
    },

    get calls(): AigatewayCall[] {
      return get.mock.calls.map(([name]) => ({ name }));
    },

    clear(): void {
      get.mockClear();
    },

    reset(): void {
      urls = {};
      get.mockReset();
      get.mockImplementation(defaultGet);
    },
  };

  return withDispose(facade, () => {
    root.aigateway = prev;
  });
}
