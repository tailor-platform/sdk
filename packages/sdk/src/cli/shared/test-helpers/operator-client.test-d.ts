import { assertType, describe, expectTypeOf, test, vi } from "vitest";
import { mockOperatorClient } from "./operator-client";

describe("mockOperatorClient", () => {
  test("accepts responses and implementations shaped like the RPC", () => {
    const client = mockOperatorClient({
      getUserProfileConfig: { userProfileProviderConfig: { providerType: 1 } },
      getTenantConfig: async (request) => {
        expectTypeOf(request.namespaceName).toEqualTypeOf<string | undefined>();
        return { tenantProviderConfig: {} };
      },
      async *downloadFunctionRegistryScript() {
        yield {};
      },
    });

    assertType(client.getUserProfileConfig.mockResolvedValueOnce({}));
  });

  test("rejects a response the RPC cannot send", () => {
    assertType(
      mockOperatorClient({
        // @ts-expect-error A response field of another message
        getUserProfileConfig: { providerType: 1 },
      }),
    );
    assertType(
      mockOperatorClient({
        // @ts-expect-error A misspelled response field
        getTenantConfig: { tenantProviderConfig: {}, tenantProvider: {} },
      }),
    );
    assertType(
      mockOperatorClient({
        // @ts-expect-error An implementation's response with no field of the RPC's
        getTenantConfig: async () => ({ tenantProvider: {} }),
      }),
    );
    assertType(
      mockOperatorClient({
        getUserProfileConfig: {
          // @ts-expect-error A misspelled nested field
          userProfileProviderConfig: { providerTyp: 1 },
        },
      }),
    );
  });

  test("checks the requests of a client-streaming method", () => {
    assertType(
      mockOperatorClient({
        createFunctionRegistry: async (requests) => {
          for await (const request of requests) {
            // @ts-expect-error A field the request does not have
            assertType(request.functionRegistryName);
          }
          return {};
        },
      }),
    );
  });

  test("rejects a vi.fn spy, which leaves its response unchecked", () => {
    const methods = { getTenantConfig: vi.fn() };

    // @ts-expect-error A spy in methods passed by variable
    assertType(mockOperatorClient(methods));
    // @ts-expect-error A spy spread into the methods
    assertType(mockOperatorClient({ ...methods }));
    assertType(
      mockOperatorClient({
        // @ts-expect-error A spy whose implementation returns a valid response
        getTenantConfig: vi.fn(async () => ({ tenantProviderConfig: {} })),
      }),
    );
  });

  test("rejects a method the client does not have", () => {
    assertType(
      mockOperatorClient({
        // @ts-expect-error A misspelled method name
        getUserProfileConfg: {},
      }),
    );
  });

  test("types the spies it returns", () => {
    const client = mockOperatorClient({ getUserProfileConfig: {} });

    // @ts-expect-error A response field of another message
    assertType(client.getUserProfileConfig.mockResolvedValueOnce({ providerType: 1 }));
  });
});
