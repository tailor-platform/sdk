import type { OperatorClient } from "#/cli/shared/client";
import type { DeployLock } from "./deploy-lock";

/** RPC name prefixes that never change workspace state. Everything else is fenced. */
export const READ_ONLY_RPC_PREFIXES = ["get", "list", "download", "compose", "ping"] as const;

/**
 * Whether an operator RPC changes workspace state and must be fenced.
 * @param methodName - Local RPC name on the operator client
 * @returns True unless the name carries a read-only prefix
 */
export function isMutatingRpc(methodName: string): boolean {
  return !READ_ONLY_RPC_PREFIXES.some((prefix) => methodName.startsWith(prefix));
}

/**
 * Wrap a client so every mutating RPC first checks that the deploy lock is
 * still held. The check runs when the call is made, so a method reference
 * taken before a takeover is still stopped afterwards; a call that already
 * left the process is not.
 * @param client - Operator client instance
 * @param lock - Lock the caller holds
 * @returns Client whose mutating calls stop once the lock is lost
 */
export function fenceClient(client: OperatorClient, lock: DeployLock): OperatorClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== "string" || typeof value !== "function" || !isMutatingRpc(property)) {
        return value;
      }
      return (...args: unknown[]) => {
        lock.assertHeld();
        return (value as (...args: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
