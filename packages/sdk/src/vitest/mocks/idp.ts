import { type Mock, vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { ClientConfig, IdpClientConstructor, IdpClientInstance } from "../../runtime/idp";

type IdpMethod = keyof IdpClientInstance;
type IdpResult<Method extends IdpMethod> = Awaited<ReturnType<IdpClientInstance[Method]>>;
type IdpResolver = (method: string, args: unknown[], namespace: string) => unknown;

interface IdpCall {
  method: string;
  args: unknown[];
  namespace: string;
}

/** Controls fallback behavior for IdP calls without a configured result. */
export interface MockIdpOptions {
  /** Return a type-compatible fixture or throw when no behavior is configured. */
  onUnhandled?: "fallback" | "error";
}

type IdpNamespaceMocks = {
  [Method in IdpMethod]: Mock<IdpClientInstance[Method]>;
};

const IDP_METHODS = [
  "users",
  "user",
  "userByName",
  "createUser",
  "updateUser",
  "deleteUser",
  "sendPasswordResetEmail",
  "unenrollMfa",
] as const satisfies readonly IdpMethod[];

const IDP_USER_DEFAULT = {
  id: "mock-id",
  name: "mock-user",
  disabled: false,
  mfaEnrolled: false,
  mfaFactorIds: [],
};

const IDP_DEFAULTS: Record<IdpMethod, unknown> = {
  users: { users: [], nextPageToken: null, totalCount: 0 },
  user: IDP_USER_DEFAULT,
  userByName: IDP_USER_DEFAULT,
  createUser: IDP_USER_DEFAULT,
  updateUser: IDP_USER_DEFAULT,
  deleteUser: true,
  sendPasswordResetEmail: true,
  unenrollMfa: true,
};

/**
 * Acquire a disposable mock for `tailor.idp`. Restored on dispose.
 * @param options - Controls behavior for calls without a configured result
 * @returns Disposable IDP mock control object
 * @example
 * ```typescript
 * import { mockIdp } from "@tailor-platform/sdk/vitest";
 *
 * test("returns a user", async () => {
 *   using idp = mockIdp();
 *   idp.namespace("my-idp").user.mockResolvedValue({
 *     id: "u-1",
 *     name: "alice",
 *     disabled: false,
 *     mfaEnrolled: false,
 *     mfaFactorIds: [],
 *   });
 *   // …
 * });
 * ```
 */
export function mockIdp(options: MockIdpOptions = {}) {
  const root = tailorRoot();
  const prev = root.idp;
  const { onUnhandled = "fallback" } = options;

  const queue: unknown[] = [];
  const calls: IdpCall[] = [];
  let resolver: IdpResolver = () => null;
  const namespaces = new Map<string, IdpNamespaceMocks>();

  function compatibilityArgs(method: IdpMethod, args: unknown[]): unknown[] {
    return method === "users" && args.length === 0 ? [undefined] : args;
  }

  function handle<Method extends IdpMethod>(
    method: Method,
    args: unknown[],
    namespace: string,
  ): IdpResult<Method> {
    if (queue.length > 0) return queue.shift() as IdpResult<Method>;
    const resolved = resolver(method, compatibilityArgs(method, args), namespace);
    if (resolved != null) return resolved as IdpResult<Method>;
    if (onUnhandled === "error") {
      throw new Error(`No IdP mock configured for "${namespace}.${method}"`);
    }
    return structuredClone(IDP_DEFAULTS[method]) as IdpResult<Method>;
  }

  function createNamespaceMocks(namespace: string): IdpNamespaceMocks {
    return {
      users: vi.fn<IdpClientInstance["users"]>(async (...args) => handle("users", args, namespace)),
      user: vi.fn<IdpClientInstance["user"]>(async (...args) => handle("user", args, namespace)),
      userByName: vi.fn<IdpClientInstance["userByName"]>(async (...args) =>
        handle("userByName", args, namespace),
      ),
      createUser: vi.fn<IdpClientInstance["createUser"]>(async (...args) =>
        handle("createUser", args, namespace),
      ),
      updateUser: vi.fn<IdpClientInstance["updateUser"]>(async (...args) =>
        handle("updateUser", args, namespace),
      ),
      deleteUser: vi.fn<IdpClientInstance["deleteUser"]>(async (...args) =>
        handle("deleteUser", args, namespace),
      ),
      sendPasswordResetEmail: vi.fn<IdpClientInstance["sendPasswordResetEmail"]>(async (...args) =>
        handle("sendPasswordResetEmail", args, namespace),
      ),
      unenrollMfa: vi.fn<IdpClientInstance["unenrollMfa"]>(async (...args) =>
        handle("unenrollMfa", args, namespace),
      ),
    };
  }

  function namespace(name: string): IdpNamespaceMocks {
    const existing = namespaces.get(name);
    if (existing) return existing;
    const mocks = createNamespaceMocks(name);
    namespaces.set(name, mocks);
    return mocks;
  }

  function track<Method extends IdpMethod>(
    method: Method,
    mock: IdpNamespaceMocks[Method],
    namespaceName: string,
  ): IdpClientInstance[Method] {
    return function (this: unknown, ...args: Parameters<IdpClientInstance[Method]>) {
      calls.push({
        method,
        args: [...compatibilityArgs(method, args)],
        namespace: namespaceName,
      });
      return (
        mock as unknown as (
          ...call: Parameters<IdpClientInstance[Method]>
        ) => ReturnType<IdpClientInstance[Method]>
      ).apply(this, args);
    } as IdpClientInstance[Method];
  }

  const defaultClient = function (this: IdpClientInstance, config: ClientConfig) {
    const mocks = namespace(config.namespace);
    this.users = track("users", mocks.users, config.namespace);
    this.user = track("user", mocks.user, config.namespace);
    this.userByName = track("userByName", mocks.userByName, config.namespace);
    this.createUser = track("createUser", mocks.createUser, config.namespace);
    this.updateUser = track("updateUser", mocks.updateUser, config.namespace);
    this.deleteUser = track("deleteUser", mocks.deleteUser, config.namespace);
    this.sendPasswordResetEmail = track(
      "sendPasswordResetEmail",
      mocks.sendPasswordResetEmail,
      config.namespace,
    );
    this.unenrollMfa = track("unenrollMfa", mocks.unenrollMfa, config.namespace);
  };
  const Client = vi.fn(defaultClient) as unknown as Mock<IdpClientConstructor>;

  root.idp = { Client };

  function allMocks(): Mock[] {
    return [...namespaces.values()].flatMap((mocks) =>
      IDP_METHODS.map((method) => mocks[method] as Mock),
    );
  }

  const facade = {
    /** The mock IDP `Client` constructor (`vi.fn`). */
    Client,

    namespace,

    setResolver(value: IdpResolver): void {
      resolver = value;
    },

    /**
     * Enqueue a single result for the next IDP call.
     * The queue is shared across all methods and namespaces.
     * @param result - Result to return from the next IDP call
     */
    enqueueResult(result: unknown): void {
      queue.push(result);
    },

    /**
     * Enqueue results for multiple subsequent IDP calls.
     * The queue is shared across all methods and namespaces.
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      queue.push(...results);
    },

    get calls(): IdpCall[] {
      return calls;
    },

    clear(): void {
      calls.length = 0;
      Client.mockClear();
      for (const mock of allMocks()) mock.mockClear();
    },

    reset(): void {
      queue.length = 0;
      calls.length = 0;
      resolver = () => null;
      Client.mockReset();
      Client.mockImplementation(defaultClient);
      for (const mock of allMocks()) mock.mockReset();
    },
  };

  return withDispose(facade, () => {
    root.idp = prev;
  });
}
