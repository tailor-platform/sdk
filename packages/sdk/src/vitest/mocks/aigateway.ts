import { vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { AIGatewayName } from "@tailor-platform/sdk";

interface AigatewayCall {
  name: AIGatewayName;
}

// ---------------------------------------------------------------------------
// AI Gateway Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.aigateway`. Restored on dispose.
 * @returns Disposable AI Gateway mock control object
 * @example
 * ```typescript
 * import { mockAigateway } from "@tailor-platform/sdk/vitest";
 *
 * test("resolves an AI Gateway URL", async () => {
 *   using aigateway = mockAigateway();
 *   aigateway.setUrls({ "my-aigateway": "https://my-aigateway.example.com" });
 *   // …
 * });
 * ```
 */
export function mockAigateway() {
  const root = tailorRoot();
  const prev = root.aigateway;

  let urls: Partial<Record<AIGatewayName, string>> = {};
  const get = vi.fn(async (name: AIGatewayName): Promise<{ url: string }> => {
    const url = urls[name];
    if (url === undefined) {
      throw new Error(
        `No AI Gateway registered for "${name}". Acquire mockAigateway() and call setUrls(...).`,
      );
    }
    return { url };
  });

  root.aigateway = { get };

  const facade = {
    /** The `get` `vi.fn`. */
    get,

    setUrls(value: Partial<Record<AIGatewayName, string>>): void {
      urls = value;
    },

    get calls(): AigatewayCall[] {
      return get.mock.calls.map(([name]) => ({ name }));
    },

    reset(): void {
      urls = {};
      get.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.aigateway = prev;
  });
}
