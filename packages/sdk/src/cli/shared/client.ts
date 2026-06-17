import { OAuth2Client } from "@badgateway/oauth2-client";
import { create } from "@bufbuild/protobuf";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import {
  type Client,
  Code,
  ConnectError,
  createClient,
  type Interceptor,
  type Transport,
  type UnaryResponse,
} from "@connectrpc/connect";
import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { getGlobalDispatcher } from "undici";
import { z } from "zod";
import { createApplyLimiter } from "./apply-concurrency";
import { logger } from "./logger";
import { userAgent } from "./user-agent";

export const platformBaseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";

const oauth2ClientId =
  process.env.PLATFORM_OAUTH2_CLIENT_ID ?? "cpoc_0Iudir72fqSpqC6GQ58ri1cLAqcq5vJl";
const oauth2DiscoveryEndpoint = "/.well-known/oauth-authorization-server/oauth2/platform";

/**
 * Initialize an OAuth2 client for Tailor Platform.
 * @returns Configured OAuth2 client
 */
export function initOAuth2Client() {
  return new OAuth2Client({
    clientId: oauth2ClientId,
    server: platformBaseUrl,
    discoveryEndpoint: oauth2DiscoveryEndpoint,
  });
}

export type OperatorClient = Client<typeof OperatorService>;

/**
 * Initialize an Operator client with the given access token.
 * @param accessToken - Access token for authentication
 * @returns Configured Operator client
 */
export async function initOperatorClient(accessToken: string) {
  const { createTracingInterceptor } = await import("@/cli/telemetry/interceptor");

  const interceptors: Interceptor[] = [
    await userAgentInterceptor(),
    await bearerTokenInterceptor(accessToken),
    retryInterceptor(),
    errorHandlingInterceptor(),
    createTracingInterceptor(),
    // Innermost: gates the actual network attempt so each retry re-acquires a
    // slot and backoff waits happen outside the cap.
    concurrencyLimitInterceptor(),
  ];

  const transport = await createTransport(platformBaseUrl, interceptors);
  return createClient(OperatorService, transport);
}

/**
 * Create a Connect transport using connect-node (HTTP/2).
 *
 * connect-node works on both Node.js and Bun. connect-web is not used because
 * it does not support client_streaming, which is required for function uploads.
 * @param baseUrl - Base URL for the transport
 * @param interceptors - Request interceptors
 * @returns Configured transport
 */
export async function createTransport(
  baseUrl: string,
  interceptors: Interceptor[],
): Promise<Transport> {
  const { createConnectTransport } = await import("@connectrpc/connect-node");
  return createConnectTransport({ httpVersion: "2", baseUrl, interceptors });
}

/**
 * Create an interceptor that sets a User-Agent header.
 * @returns User-Agent interceptor
 */
async function userAgentInterceptor(): Promise<Interceptor> {
  const ua = await userAgent();
  return (next) => async (req) => {
    req.header.set("User-Agent", ua);
    return await next(req);
  };
}

export { userAgent };

/**
 * Create an interceptor that sets the Authorization bearer token.
 * @param accessToken - Access token to use
 * @returns Bearer token interceptor
 */
async function bearerTokenInterceptor(accessToken: string): Promise<Interceptor> {
  return (next) => async (req) => {
    req.header.set("Authorization", `Bearer ${accessToken}`);
    return await next(req);
  };
}

/**
 * Create an interceptor that retries failed unary requests with backoff.
 *
 * Retries any unary method on `Unavailable`/`ResourceExhausted`, and `Internal`
 * only for methods declared idempotent, up to 3 attempts (despite the historical
 * "idempotent" naming, the first two codes are retried regardless of idempotency).
 * As a targeted exception for the deploy/apply flow, a post-retry `AlreadyExists`
 * from an allowlisted Create (see `RETRY_SAFE_CREATE_METHODS`) is treated as
 * success, since it means a prior attempt already committed the resource
 * server-side. A first-attempt `AlreadyExists` from such a Create still
 * surfaces, but is routed to crash/error reporting first (the top-level handler
 * skips `ConnectError`), so the otherwise-silent compound-create race is
 * trackable.
 * @internal
 * @returns Retry interceptor
 */
export function retryInterceptor(): Interceptor {
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    let lastError: unknown;
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await waitRetryBackoff(i);
      }

      try {
        return await next(req);
      } catch (error) {
        // A retry that comes back AlreadyExists is treated as success: a prior
        // attempt (the one whose retriable error sent us here) already created
        // the resource server-side, but its response was lost as
        // Unavailable/ResourceExhausted under load. The identical retry then
        // races against that committed write and fails with `already_exists`.
        // Restricted to RETRY_SAFE_CREATE_METHODS (deploy creates whose response
        // body is unused) and to actual retries (i > 0).
        if (isRetrySafeCreateAlreadyExists(error, req.method.name)) {
          if (i > 0) {
            logger.debug(
              `retry: ${req.method.name} returned AlreadyExists on attempt ${i + 1}; ` +
                `treating as success (prior attempt likely committed)`,
            );
            return synthesizeEmptyUnaryResponse(req);
          }
          // First-attempt AlreadyExists on a retry-safe create: no retry of ours
          // preceded it, so the resource was committed out-of-band (a concurrent
          // or non-idempotent compound create under load — #1350). The top-level
          // handler skips ConnectError, so route it to error tracking here before
          // letting it surface as the deploy error.
          const { reportCrash } = await import("@/cli/crashreport");
          await reportCrash(error, "handledError");
        }
        if (isRetirable(error, req.method.idempotency)) {
          lastError = error;
          logger.debug(
            `retry: ${req.method.name} attempt ${i + 1} failed with ` +
              `${connectCodeName(error)}; retrying`,
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
}

/**
 * Create an interceptor that caps the number of concurrent unary RPCs.
 *
 * A fresh-workspace apply fires one `create*` per resource at once; left
 * unbounded, the platform sheds load as `Unavailable`/`ResourceExhausted`,
 * which drives retries into the non-idempotent compound-create `already_exists`
 * race (#1350). One shared limiter per client bounds total in-flight calls
 * across every deploy resource, not just a single call site. Streaming RPCs
 * (e.g. function uploads) are not gated.
 * @returns Concurrency-limiting interceptor
 */
function concurrencyLimitInterceptor(): Interceptor {
  const limit = createApplyLimiter();
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }
    return await limit(() => next(req));
  };
}

/**
 * Human-readable name for the Connect status code of an error, for diagnostics.
 * @param error - Error thrown by a request (expected to be a ConnectError)
 * @returns The Code name (e.g., "Unavailable"), or "unknown" for non-ConnectError
 */
function connectCodeName(error: unknown): string {
  return error instanceof ConnectError ? Code[error.code] : "unknown";
}

/**
 * Create RPCs for which a post-retry `AlreadyExists` may be treated as success.
 *
 * Membership is deliberately an allowlist, not `startsWith("Create")`: swallowing
 * synthesizes an empty response (see `synthesizeEmptyUnaryResponse`), which is only
 * safe when every caller ignores the response body. These are the deploy/apply
 * resource creations that fire under heavy parallelism and discard their response.
 *
 * Intentionally excluded because their callers read the response body — swallowing
 * would hand back an empty message and corrupt downstream state:
 * - `CreateIdPClient` (uses `resp.client.clientSecret` to seed the secret vault)
 * - `CreateWorkflowJobFunction` (uses `response.jobFunction.version`)
 * - `CreateWorkspace` / `CreatePersonalAccessToken` / `CreateDeployment` /
 *   `CreateOrganizationFolder` (interactive commands that return created data)
 *
 * `CreateFunctionRegistry` is client-streaming and never reaches this path
 * (streaming requests bypass the retry loop entirely).
 *
 * An allowlist miss is safe: the resource simply loses race protection and an
 * `already_exists` surfaces loudly, as before — never a silent empty response.
 *
 * A drift guard (see client.test.ts) fails CI if any `client.create*` used in the
 * deploy flow is neither listed here nor explicitly classified as response-consuming,
 * so a newly added apply create cannot silently miss this list.
 * @internal
 */
export const RETRY_SAFE_CREATE_METHODS: ReadonlySet<string> = new Set([
  "CreateAIGateway",
  "CreateApplication",
  "CreateAuthConnection",
  "CreateAuthHook",
  "CreateAuthIDPConfig",
  "CreateAuthMachineUser",
  "CreateAuthOAuth2Client",
  "CreateAuthSCIMConfig",
  "CreateAuthSCIMResource",
  "CreateAuthService",
  "CreateExecutorExecutor",
  "CreateIdPService",
  "CreatePipelineResolver",
  "CreatePipelineService",
  "CreateSecretManagerSecret",
  "CreateSecretManagerVault",
  "CreateStaticWebsite",
  "CreateTailorDBGQLPermission",
  "CreateTailorDBService",
  "CreateTailorDBType",
  "CreateTenantConfig",
  "CreateUserProfileConfig",
  "CreateWorkflow",
]);

/**
 * Whether an error is an `AlreadyExists` from a retry-safe Create RPC.
 *
 * Only `AlreadyExists` stands in for "my prior write already landed"; for other
 * verbs/codes it would be a real conflict that must surface.
 * @param error - Error thrown by the request
 * @param methodName - RPC method name (e.g., "CreateTailorDBType")
 * @returns True if the error is an `AlreadyExists` from a retry-safe Create method
 */
function isRetrySafeCreateAlreadyExists(error: unknown, methodName: string): boolean {
  return (
    error instanceof ConnectError &&
    error.code === Code.AlreadyExists &&
    RETRY_SAFE_CREATE_METHODS.has(methodName)
  );
}

/**
 * Build a default (empty) unary response for the request's output message.
 *
 * Used when a retried Create is determined to have already succeeded on a prior
 * attempt: callers in the deploy pipeline ignore Create response bodies, so an
 * empty message faithfully represents the already-applied state.
 * @param req - Unary request whose output schema is used
 * @returns A synthesized unary response with an empty output message
 */
function synthesizeEmptyUnaryResponse(req: {
  service: UnaryResponse["service"];
  method: UnaryResponse["method"];
}): UnaryResponse {
  return {
    stream: false,
    service: req.service,
    method: req.method,
    header: new Headers(),
    message: create(req.method.output),
    trailer: new Headers(),
  };
}

/**
 * Base delay (ms) for the first retry. Subsequent attempts double it.
 *
 * Kept relatively large so a retry does not immediately race an original request
 * that is still settling server-side under load (e.g. a compound create whose
 * response was lost), which is what triggers the `already_exists` race.
 */
const RETRY_BASE_DELAY_MS = 500;

/**
 * Wait for an exponential backoff delay with jitter.
 * @param attempt - Current retry attempt number (1-based)
 * @returns Promise that resolves after the delay
 */
function waitRetryBackoff(attempt: number) {
  const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = 0.1 * (Math.random() * 2 - 1);
  const backoff = base * (1 + jitter);
  return new Promise((resolve) => setTimeout(resolve, backoff));
}

/**
 * Determine whether the given error is retriable for the method idempotency.
 * @param error - Error thrown by the request
 * @param idempotency - Method idempotency level
 * @returns True if the error should be retried
 */
function isRetirable(error: unknown, idempotency: MethodOptions_IdempotencyLevel) {
  if (!(error instanceof ConnectError)) {
    return false;
  }

  switch (error.code) {
    case Code.ResourceExhausted:
    case Code.Unavailable:
      return true;
    case Code.Internal:
      return (
        idempotency === MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS ||
        idempotency === MethodOptions_IdempotencyLevel.IDEMPOTENT
      );
    default:
      return false;
  }
}

/**
 * Create an interceptor that enhances error messages from the Operator API.
 * @returns Error handling interceptor
 */
function errorHandlingInterceptor(): Interceptor {
  return (next) => async (req) => {
    try {
      return await next(req);
    } catch (error) {
      if (error instanceof ConnectError) {
        const { operation, resourceType } = parseMethodName(req.method.name);
        const requestParams = formatRequestParams(req.message);

        // Re-throw as ConnectError with enhanced message to avoid re-wrapping
        // Use rawMessage to avoid duplicating the error code prefix
        throw new ConnectError(
          `Failed to ${operation} ${resourceType}: ${error.rawMessage}\nRequest: ${requestParams}`,
          error.code,
          error.metadata,
        );
      }
      throw error;
    }
  };
}

/**
 * @internal
 * @param methodName - RPC method name (e.g., "CreateWorkspace")
 * @returns Parsed operation and resource type
 */
export function parseMethodName(methodName: string): {
  operation: string;
  resourceType: string;
} {
  const match = methodName.match(/^(Create|Update|Delete|Set|List|Get)(.+)$/);
  if (!match) {
    return { operation: "perform", resourceType: "resource" };
  }

  const [, action, resource] = match as [string, string, string];
  return { operation: action.toLowerCase(), resourceType: resource };
}

/**
 * JSON.stringify replacer that converts BigInt values to strings.
 * @param _key - Object key (unused)
 * @param value - Value to serialize
 * @returns Serializable value
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

/**
 * @internal
 * @param message - Request message to format
 * @returns Pretty-printed JSON or error placeholder
 */
export function formatRequestParams(message: unknown): string {
  try {
    if (message && typeof message === "object" && "toJson" in message) {
      return JSON.stringify((message as { toJson: () => unknown }).toJson(), bigIntReplacer, 2);
    }
    return JSON.stringify(message, bigIntReplacer, 2);
  } catch {
    return "(unable to serialize request)";
  }
}

export const MAX_PAGE_SIZE = 1000;

/**
 * Fetch all paginated resources by repeatedly calling the given function.
 * @template T
 * @param fn - Page fetcher returning items and next page token
 * @returns All fetched items
 */
export async function fetchAll<T>(
  fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>,
) {
  const items: T[] = [];
  let pageToken = "";

  // loop exits when the platform stops returning a page token
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const [batch, nextPageToken] = await fn(pageToken, MAX_PAGE_SIZE);
    items.push(...batch);
    // loop exits when the platform stops returning a page token
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return items;
}

interface FetchPagedOptions {
  /** Maximum number of items to return. 0 or undefined means unlimited. */
  limit?: number;
}

/**
 * Fetch paginated resources with an optional upper bound on the number of
 * items returned. When `limit` is 0 or undefined the function behaves
 * like `fetchAll` and returns every page. When `limit` is positive the
 * function stops once enough items are collected, requesting smaller
 * pages as it approaches the boundary.
 * @template T
 * @param fn - Page fetcher returning items and next page token
 * @param options - Pagination options
 * @returns Fetched items (length <= limit when limit > 0)
 */
export async function fetchPaged<T>(
  fn: (pageToken: string, pageSize: number) => Promise<[T[], string]>,
  options?: FetchPagedOptions,
): Promise<T[]> {
  const limit = options?.limit;
  const unbounded = limit === undefined || limit === 0;
  const items: T[] = [];
  let pageToken = "";

  // loop exits when the platform stops returning a page token
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const pageSize = unbounded ? MAX_PAGE_SIZE : Math.min(limit - items.length, MAX_PAGE_SIZE);
    if (!unbounded && pageSize <= 0) break;

    const [batch, nextPageToken] = await fn(pageToken, pageSize);
    items.push(...batch);
    if (!unbounded && items.length >= limit) break;
    // loop exits when the platform stops returning a page token
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  if (!unbounded && items.length > limit) {
    return items.slice(0, limit);
  }
  return items;
}

/**
 * Fetch user info from the Tailor Platform userinfo endpoint.
 * @param accessToken - Access token for the current user
 * @returns Parsed user info
 */
export async function fetchUserInfo(accessToken: string) {
  const userInfoUrl = new URL("/auth/platform/userinfo", platformBaseUrl).href;
  const resp = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": await userAgent(),
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch user info: ${resp.statusText}`);
  }

  const rawJson = await resp.json();
  const schema = z.object({
    email: z.string(),
  });
  return schema.parse(rawJson);
}

// Converting "name:url" patterns to actual Static Website URLs
/**
 * Options for `resolveStaticWebsiteUrls`.
 */
export type ResolveStaticWebsiteUrlsOptions = {
  /**
   * Names of static websites that are defined locally in the current
   * configuration. When the platform-side lookup for a name in this set
   * fails specifically with a `NotFound` error, the warning is suppressed
   * and the original `name:url[/path]` pattern is returned unresolved
   * instead of being dropped.
   *
   * Use this from plan-phase callers to avoid noisy warnings on the first
   * deployment, where the static website will be created later in the same
   * apply run. Other failure modes ("URL not yet assigned", transient RPC
   * errors, permission errors) are intentionally not suppressed so that
   * real platform problems still surface during planning.
   */
  expectedLocalNames?: ReadonlySet<string>;
};

/**
 * Resolve "name:url" patterns to actual Static Website URLs.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param urls - URLs or name:url patterns
 * @param context - Logging context (e.g., "CORS", "OAuth2 redirect URIs")
 * @param options - Optional behavior overrides
 * @returns Resolved URLs (or the original pattern for entries marked as
 *   expected-but-not-yet-deployed via `options.expectedLocalNames`)
 */
export async function resolveStaticWebsiteUrls(
  client: OperatorClient,
  workspaceId: string,
  urls: string[] | undefined,
  context: string, // for logging context (e.g., "CORS", "OAuth2 redirect URIs")
  options: ResolveStaticWebsiteUrlsOptions = {},
): Promise<string[]> {
  if (!urls) {
    return [];
  }

  const { expectedLocalNames } = options;

  const results = await Promise.all(
    urls.map(async (url) => {
      const urlPattern = /:url(\/.*)?$/;
      const match = url.match(urlPattern);

      if (match && match.index !== undefined) {
        const siteName = url.substring(0, match.index);
        const pathSuffix = match[1] || "";

        try {
          const response = await client.getStaticWebsite({
            workspaceId,
            name: siteName,
          });

          if (response.staticwebsite?.url) {
            return [response.staticwebsite.url + pathSuffix];
          }
          logger.warn(
            `Static website "${siteName}" has no URL assigned yet. Excluding from ${context}.`,
          );
          return [];
        } catch (error) {
          const isNotFound = error instanceof ConnectError && error.code === Code.NotFound;
          if (isNotFound && expectedLocalNames?.has(siteName)) {
            return [url];
          }
          logger.warn(
            `Static website "${siteName}" not found for ${context} configuration. Excluding from ${context}.`,
          );
          return [];
        }
      }
      return [url];
    }),
  );

  return results.flat();
}

/**
 * Fetch an OAuth2 access token for a machine user.
 * @param url - OAuth2 server base URL
 * @param clientId - Client ID for the machine user
 * @param clientSecret - Client secret for the machine user
 * @returns Access token
 */
export async function fetchMachineUserToken(url: string, clientId: string, clientSecret: string) {
  const tokenEndpoint = new URL("/oauth2/token", url).href;
  const formData = new URLSearchParams();
  formData.append("grant_type", "client_credentials");
  formData.append("client_id", clientId);
  formData.append("client_secret", clientSecret);

  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "User-Agent": await userAgent(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });
  if (!resp.ok) {
    throw new Error("Failed to fetch machine user token");
  }
  const rawJson = await resp.json();

  const schema = z.object({
    token_type: z.string(),
    access_token: z.string(),
    expires_in: z.number(),
  });
  return schema.parse(rawJson);
}

/**
 * Fetch an OAuth2 token for a platform machine user via client_credentials grant.
 * @param clientId - Client ID for the platform machine user
 * @param clientSecret - Client secret for the platform machine user
 * @returns OAuth2 token
 */
export async function fetchPlatformMachineUserToken(clientId: string, clientSecret: string) {
  const client = new OAuth2Client({
    clientId,
    clientSecret,
    server: platformBaseUrl,
    discoveryEndpoint: oauth2DiscoveryEndpoint,
  });
  return await client.clientCredentials();
}

/**
 * Close undici's global HTTP connection pool to prevent libuv UV_HANDLE_CLOSING
 * assertion failure on Windows at process exit (Node.js 23.x+).
 * See: https://github.com/nodejs/node/issues/56645
 */
export async function closeConnectionPool() {
  await getGlobalDispatcher().close();
}
