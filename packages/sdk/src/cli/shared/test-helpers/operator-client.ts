import { vi, type Mock } from "vitest";
import type { OperatorClient } from "#/cli/shared/client";
import type { ServiceImpl } from "@connectrpc/connect";
import type { OperatorService } from "@tailor-platform/tailor-proto/service_pb";

type OperatorMethod = keyof OperatorClient;

type MethodImpl<K extends OperatorMethod> = (
  ...args: Parameters<OperatorClient[K]>
) => ReturnType<ServiceImpl<typeof OperatorService>[K]>;

/**
 * A method's implementation as a plain function; its `mock` rejects a `vi.fn` spy, whose response
 * would go unchecked.
 */
type PlainImpl<K extends OperatorMethod> = {
  (...args: Parameters<MethodImpl<K>>): ReturnType<MethodImpl<K>>;
  mock?: never;
};

type MethodResponse<K extends OperatorMethod> = Awaited<ReturnType<MethodImpl<K>>>;

/**
 * A method's mock: the response it returns to every request, or its implementation. A streaming
 * method takes only an implementation, which starts a new stream on each call.
 */
type MethodMock<K extends OperatorMethod> =
  | (MethodResponse<K> extends AsyncIterable<unknown> ? never : MethodResponse<K>)
  | PlainImpl<K>;

/** Mocks of the methods `K`, as {@link mockOperatorClient} takes them. */
export type OperatorClientMocks<K extends OperatorMethod> = { [P in K]: MethodMock<P> };

/** A client whose methods `K` are `vi.fn` spies, as {@link mockOperatorClient} returns it. */
export type OperatorClientMock<K extends OperatorMethod> = OperatorClient & {
  [P in K]: Mock<MethodImpl<P>>;
};

function implementationOf(mock: unknown): (...args: never[]) => unknown {
  if (typeof mock === "function") return mock as (...args: never[]) => unknown;
  return async () => mock;
}

/**
 * Build an operator client whose methods return responses shaped like the Platform's, as spies.
 * Give each method the response itself, or an implementation that receives the request, such as an
 * async generator function for a streaming method. A response given directly is also checked for
 * unknown fields; one an implementation returns is not.
 * @param methods - The mocked methods; the others are absent, as on a client cast from `{}`
 * @returns The client, with each mocked method as a `vi.fn` spy
 */
export function mockOperatorClient<K extends OperatorMethod>(
  methods: OperatorClientMocks<K>,
): OperatorClientMock<K> {
  const spies = Object.fromEntries(
    Object.entries(methods).map(([name, mock]) => [name, vi.fn(implementationOf(mock))]),
  );
  return spies as unknown as OperatorClientMock<K>;
}

/**
 * Copy a client with `methods` mocked on top of its methods, keeping the spy types of both, which a
 * spread loses.
 * @param client - The client to copy, such as one from {@link mockOperatorClient}
 * @param methods - The methods to mock or replace, as {@link mockOperatorClient} takes them; none when undefined
 * @returns A new client, with each method in `methods` as a `vi.fn` spy
 */
export function withOperatorClientMocks<C extends OperatorClient, K extends OperatorMethod = never>(
  client: C,
  methods: OperatorClientMocks<K> | undefined,
): C & OperatorClientMock<K> {
  return Object.assign({}, client, methods && mockOperatorClient(methods));
}
