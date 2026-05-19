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
 * `TailorRuntime` / `TailordbRuntime` aggregates in `./internal`, which in turn
 * compose the per-service `TailorXxxAPI` types declared alongside each wrapper.
 * Namespaces `Tailor` / `Tailordb` are kept as type-only views so callers can
 * still write `Tailor.idp.User` or `Tailor.context.Invoker` in type position.
 */

/* eslint-disable @typescript-eslint/no-namespace */

import type { ContextInvoker } from "./context";
import type { TailorDBFileErrorCode } from "./file";
import type {
  ClientConfig as IdpClientConfig,
  CreateUserInput as IdpCreateUserInput,
  ListUsersOptions as IdpListUsersOptions,
  ListUsersResponse as IdpListUsersResponse,
  SendPasswordResetEmailInput as IdpSendPasswordResetEmailInput,
  UpdateUserInput as IdpUpdateUserInput,
  User as IdpUser,
  UserQuery as IdpUserQuery,
} from "./idp";
import type {
  TailordbCommandType,
  TailordbQueryResult,
  TailordbRuntime,
  TailorRuntime,
} from "./internal";
import type {
  AuthInvoker as WorkflowAuthInvoker,
  TriggerWorkflowOptions as WorkflowTriggerWorkflowOptions,
} from "./workflow";

declare global {
  namespace Tailordb {
    type QueryResult<T> = TailordbQueryResult<T>;
    type CommandType = TailordbCommandType;
  }

  // eslint-disable-next-line no-var
  var tailordb: TailordbRuntime;

  namespace Tailor {
    namespace idp {
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
