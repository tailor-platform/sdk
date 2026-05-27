/**
 * Ambient global type definitions for the Tailor Platform Function runtime.
 *
 * The Tailor Platform Function runtime injects `tailor.*` and `tailordb`
 * objects into the global scope. This file declares their type signatures so
 * they can be referenced from any TypeScript code that runs in (or is bundled
 * for) the runtime.
 * @example
 * // Side-effect import to enable the global types in a single file:
 * import "@tailor-platform/sdk/runtime/globals";
 *
 * // Or register globally in tsconfig.json:
 * // "compilerOptions": { "types": ["@tailor-platform/sdk/runtime/globals"] }
 *
 * Most users do not need to import this directly — `@tailor-platform/sdk/runtime`
 * exposes typed wrappers that cover the same surface without relying on globals.
 *
 * The value declarations (`var tailor` / `var tailordb`) are typed via the
 * `TailorRuntime` / `TailordbRuntime` aggregates re-exported from `.`, which in
 * turn compose the per-service `TailorXxxAPI` types declared alongside each
 * wrapper. Type-only `namespace tailor` / `namespace tailordb` declarations
 * are merged with those vars so callers can write `tailor.idp.User` or
 * `tailor.context.Invoker` in type position as well.
 */

/* eslint-disable @typescript-eslint/no-namespace */

import type {
  TailordbClientInstance,
  TailordbCommandType,
  TailordbQueryResult,
  TailordbRuntime,
  TailorRuntime,
} from ".";
import type { ContextInvoker } from "./context";
import type { TailorDBFileErrorCode } from "./file";
import type { IconvInstance } from "./iconv";
import type {
  ClientConfig as IdpClientConfig,
  CreateUserInput as IdpCreateUserInput,
  IdpClientInstance,
  ListUsersOptions as IdpListUsersOptions,
  ListUsersResponse as IdpListUsersResponse,
  SendPasswordResetEmailInput as IdpSendPasswordResetEmailInput,
  UpdateUserInput as IdpUpdateUserInput,
  User as IdpUser,
  UserQuery as IdpUserQuery,
} from "./idp";
import type {
  AuthInvoker as WorkflowAuthInvoker,
  TriggerWorkflowOptions as WorkflowTriggerWorkflowOptions,
} from "./workflow";

declare global {
  namespace tailordb {
    type QueryResult<T> = TailordbQueryResult<T>;
    type CommandType = TailordbCommandType;
    type Client = TailordbClientInstance;
  }

  // eslint-disable-next-line no-var
  var tailordb: TailordbRuntime;

  /**
   * @deprecated Use the lowercase `tailordb.*` namespace instead (e.g.
   *   `tailordb.QueryResult`, `tailordb.CommandType`,
   *   `typeof tailordb.Client`). This capital-cased namespace is retained
   *   only for backwards compatibility with `@tailor-platform/function-types`
   *   and will be removed in v2. Run
   *   `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace`
   *   to migrate.
   */
  namespace Tailordb {
    /**
     * @deprecated Use `tailordb.Client` (lowercase) instead.
     *   Will be removed in v2.
     */
    class Client {
      constructor(config: { namespace: string });
      connect(): Promise<void>;
      end(): Promise<void>;
      queryObject<O>(sql: string, args?: readonly unknown[]): Promise<TailordbQueryResult<O>>;
    }

    /**
     * @deprecated Use `tailordb.QueryResult<T>` (lowercase) instead.
     *   Will be removed in v2.
     */
    type QueryResult<T> = TailordbQueryResult<T>;

    /**
     * @deprecated Use `tailordb.CommandType` (lowercase) instead.
     *   Will be removed in v2.
     */
    type CommandType = TailordbCommandType;
  }

  namespace tailor {
    namespace iconv {
      type Iconv = IconvInstance;
    }

    namespace idp {
      type Client = IdpClientInstance;
      type ClientConfig = IdpClientConfig;
      type User = IdpUser;
      type UserQuery = IdpUserQuery;
      type ListUsersOptions = IdpListUsersOptions;
      type ListUsersResponse = IdpListUsersResponse;
      type CreateUserInput = IdpCreateUserInput;
      type UpdateUserInput = IdpUpdateUserInput;
      type SendPasswordResetEmailInput = IdpSendPasswordResetEmailInput;
    }

    namespace workflow {
      type AuthInvoker = WorkflowAuthInvoker;
      type TriggerWorkflowOptions = WorkflowTriggerWorkflowOptions;
    }

    namespace context {
      type Invoker = ContextInvoker;
    }
  }

  // eslint-disable-next-line no-var
  var tailor: TailorRuntime;

  /** Custom error class for TailorDB File operations. */
  class TailorDBFileError extends Error {
    constructor(message: string, code?: TailorDBFileErrorCode, cause?: unknown);
    name: "TailorDBFileError";
    code?: TailorDBFileErrorCode;
    cause?: unknown;
  }

  /** Individual error entry attached to {@link TailorErrors}. */
  interface TailorErrorItem {
    message: string;
    path: (string | number)[];
  }

  /**
   * Aggregate validation error raised by the Tailor Platform Function runtime.
   * The runtime serializes the items into the `message` (`"TailorErrors: {...}"`)
   * and also exposes them on `.errors`.
   */
  class TailorErrors extends Error {
    constructor(errors: TailorErrorItem[]);
    name: "TailorErrors";
    errors: TailorErrorItem[];
  }

  /**
   * Single-message error raised by the Tailor Platform Function runtime.
   */
  class TailorErrorMessage extends Error {
    constructor(message: string);
    name: "TailorErrorMessage";
  }
}

export {};
