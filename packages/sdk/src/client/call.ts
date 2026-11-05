import { state, type Fetch } from "./state";

/**
 * Where and how resolver calls are sent. An auth client that has `getAppUri()`
 * and an authenticated `fetch` (such as AppShell's) can be passed as is.
 */
export type ResolverClientConfig =
  | {
      /** Base URL of the application, such as `https://xyz.erp.dev` (without `/query`). */
      url: string;
      /** Defaults to the global `fetch`. */
      fetch?: Fetch;
    }
  | {
      /** Returns the base URL of the application. */
      getAppUri: () => string;
      /** Sends each request, for example adding authentication. */
      fetch: Fetch;
    };

/**
 * Set where resolver calls are sent and how. Call it once at startup;
 * it takes precedence over the `url` given to the build plugin.
 * @param config - The application's URL and the `fetch` to send requests with
 */
export function configureResolvers(config: ResolverClientConfig): void {
  state.getUrl = "getAppUri" in config ? config.getAppUri : () => config.url;
  state.fetch = config.fetch;
}

/**
 * Set the URL used when {@link configureResolvers} was not called. The code
 * generated for `resolvers.tailor` calls this with the build plugin's `url`.
 * @param defaults - The URL to fall back to
 * @param defaults.url - Base URL of the application
 */
export function setResolverDefaults(defaults: { url?: string }): void {
  if (defaults.url !== undefined) state.defaultUrl = defaults.url;
}

/** A GraphQL error the application returned. */
export interface GraphQLErrorItem {
  message: string;
  extensions?: { code?: string; attr?: Record<string, unknown> };
}

/** The error thrown when a resolver call fails. */
export class ResolverError extends Error {
  /** HTTP status of the response. */
  readonly status: number;
  /** Error code the application reported, such as `RESOLVER_ERROR`. */
  readonly code: string | undefined;
  /** Details the application attached to the error. */
  readonly attr: Record<string, unknown> | undefined;
  /** Every error in the response. */
  readonly errors: readonly GraphQLErrorItem[];

  /**
   * @param init - What the failed response said
   * @param init.message - Why the call failed
   * @param init.status - HTTP status of the response
   * @param init.errors - Errors in the response, first one first
   */
  constructor(init: { message: string; status: number; errors?: readonly GraphQLErrorItem[] }) {
    super(init.message);
    this.name = "ResolverError";
    this.status = init.status;
    this.errors = init.errors ?? [];
    this.code = this.errors[0]?.extensions?.code;
    this.attr = this.errors[0]?.extensions?.attr;
  }
}

/** The GraphQL operation calling a resolver. */
export interface ResolverCall {
  /** Root field the resolver is exposed as. */
  field: string;
  /** GraphQL document to send. */
  document: string;
}

function resolveUrl(): string {
  const url = state.getUrl?.() ?? state.defaultUrl;
  if (url === undefined) {
    throw new Error(
      "No application URL is set for resolver calls. Call configureResolvers({ url }) " +
        "or pass `url` to the build plugin.",
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Call a resolver. The code generated for `resolvers.tailor` uses it.
 * @param call - The operation to send
 * @param variables - The resolver's input, one variable per input key
 * @returns The value the resolver returned
 */
export async function callResolver(
  call: ResolverCall,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const send = state.fetch ?? globalThis.fetch;
  const response = await send(`${resolveUrl()}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: call.document, variables }),
  });

  const text = await response.text();
  let body: { data?: Record<string, unknown> | null; errors?: GraphQLErrorItem[] } | undefined;
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = undefined;
  }

  const [first] = body?.errors ?? [];
  if (first) {
    throw new ResolverError({
      message: first.message,
      status: response.status,
      errors: body?.errors,
    });
  }
  if (!response.ok || body === undefined) {
    throw new ResolverError({
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }
  return body.data?.[call.field];
}
