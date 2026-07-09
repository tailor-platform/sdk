import { type Mock, vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { User as IdpUser } from "../../runtime/idp";

type IdpResolver = (method: string, args: unknown[], namespace: string) => unknown;

interface IdpCall {
  method: string;
  args: unknown[];
  namespace: string;
}

// ---------------------------------------------------------------------------
// IDP Mock
// ---------------------------------------------------------------------------

const IDP_DEFAULTS: Record<string, unknown> = {
  users: { users: [], nextPageToken: null, totalCount: 0 },
  user: { id: "mock-id", name: "mock-user", disabled: false, mfaEnrolled: false, mfaFactorIds: [] },
  userByName: {
    id: "mock-id",
    name: "mock-user",
    disabled: false,
    mfaEnrolled: false,
    mfaFactorIds: [],
  },
  createUser: {
    id: "mock-id",
    name: "mock-user",
    disabled: false,
    mfaEnrolled: false,
    mfaFactorIds: [],
  },
  updateUser: {
    id: "mock-id",
    name: "mock-user",
    disabled: false,
    mfaEnrolled: false,
    mfaFactorIds: [],
  },
  deleteUser: true,
  sendPasswordResetEmail: true,
  unenrollMfa: true,
};

/**
 * Acquire a disposable mock for `tailor.idp`. Restored on dispose.
 * @returns Disposable IDP mock control object
 * @example
 * ```typescript
 * import { mockIdp } from "@tailor-platform/sdk/vitest";
 *
 * test("resolver-based", async () => {
 *   using idp = mockIdp();
 *   idp.setResolver((method) =>
 *     method === "user" ? { id: "u-1", name: "alice", disabled: false } : null,
 *   );
 *   // …
 * });
 * ```
 */
export function mockIdp() {
  const root = tailorRoot();
  const prev = root.idp;

  const queue: unknown[] = [];
  let resolver: IdpResolver = () => null;
  const calls: IdpCall[] = [];

  function handle(method: string, args: unknown[], namespace: string): unknown {
    calls.push({ method, args, namespace });
    if (queue.length > 0) return queue.shift();
    const resolved = resolver(method, args, namespace);
    // Treat null and undefined alike as "no override".
    if (resolved != null) return resolved;
    // Clone the default so a test mutating the returned value cannot corrupt
    // the shared module-level object for subsequent tests.
    const fallback = IDP_DEFAULTS[method];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  const Client = vi.fn(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    config: { namespace: string },
  ) {
    const namespace = config.namespace;
    this.users = async (options?: unknown) => handle("users", [options], namespace);
    this.user = async (userId: string) => handle("user", [userId], namespace);
    this.userByName = async (name: string) => handle("userByName", [name], namespace);
    this.createUser = async (input: unknown) => handle("createUser", [input], namespace);
    this.updateUser = async (input: unknown) => handle("updateUser", [input], namespace);
    this.deleteUser = async (userId: string) => handle("deleteUser", [userId], namespace);
    this.sendPasswordResetEmail = async (input: unknown) =>
      handle("sendPasswordResetEmail", [input], namespace);
    this.unenrollMfa = async (input: unknown) => handle("unenrollMfa", [input], namespace);
  }) as unknown as new (config: { namespace: string }) => {
    users(options?: {
      first?: number;
      after?: string;
      query?: { ids?: string[]; names?: string[] };
    }): Promise<{ users: IdpUser[]; nextPageToken: string | null; totalCount: number }>;
    user(userId: string): Promise<IdpUser>;
    userByName(name: string): Promise<IdpUser>;
    createUser(input: { name: string; password?: string; disabled?: boolean }): Promise<IdpUser>;
    updateUser(input: {
      id: string;
      name?: string;
      password?: string;
      clearPassword?: boolean;
      disabled?: boolean;
    }): Promise<IdpUser>;
    deleteUser(userId: string): Promise<boolean>;
    sendPasswordResetEmail(input: { userId: string; redirectUri: string }): Promise<boolean>;
    unenrollMfa(input: { userId: string; mfaFactorId: string }): Promise<boolean>;
  };

  root.idp = { Client };

  const facade = {
    /** The mock IDP `Client` constructor (`vi.fn`). */
    Client: Client as unknown as Mock,

    setResolver(value: IdpResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next IDP call (FIFO; falls back to
     * `setResolver` when exhausted).
     * @param result - Result to return from the next IDP call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent IDP calls.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): IdpCall[] {
      return calls;
    },

    reset(): void {
      queue.length = 0;
      resolver = () => null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.idp = prev;
  });
}
