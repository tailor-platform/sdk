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

/** A method's mock: the response it returns to every request, or its implementation. */
type MethodMock<K extends OperatorMethod> = Awaited<ReturnType<MethodImpl<K>>> | PlainImpl<K>;

/** Mocks of the methods `K`, as {@link mockOperatorClient} takes them. */
export type OperatorClientMocks<K extends OperatorMethod> = { [P in K]: MethodMock<P> };

type OperatorClientMock<K extends OperatorMethod> = OperatorClient & {
  [P in K]: Mock<MethodImpl<P>>;
};

function implementationOf(mock: unknown): (...args: never[]) => unknown {
  if (typeof mock === "function") return mock as (...args: never[]) => unknown;
  if (typeof mock === "object" && mock !== null && Symbol.asyncIterator in mock) return () => mock;
  return async () => mock;
}

/**
 * Build an operator client whose methods return responses shaped like the Platform's, as spies.
 * Give each method the response itself, or an implementation that receives the request. A response
 * given directly is also checked for unknown fields; one an implementation returns is not.
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
