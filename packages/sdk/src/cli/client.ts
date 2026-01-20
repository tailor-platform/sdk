import { OAuth2Client } from "@badgateway/oauth2-client";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import {
  type Client,
  Code,
  ConnectError,
  createClient,
  type Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { z } from "zod";
import { logger } from "./utils/logger";
import { readPackageJson } from "./utils/package-json";

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
  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl: platformBaseUrl,
    interceptors: [
      await userAgentInterceptor(),
      await bearerTokenInterceptor(accessToken),
      retryInterceptor(),
      errorHandlingInterceptor(),
    ],
  });
  return createClient(OperatorService, transport);
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

/**
 * Build the User-Agent string for CLI requests.
 * @returns User-Agent header value
 */
export async function userAgent() {
  const packageJson = await readPackageJson();
  return `tailor-sdk/${packageJson.version ?? "unknown"}`;
}

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
 * Create an interceptor that retries idempotent requests with backoff.
 * @returns Retry interceptor
 */
function retryInterceptor(): Interceptor {
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
        if (isRetirable(error, req.method.idempotency)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
}

/**
 * Wait for an exponential backoff delay with jitter.
 * @param attempt - Current retry attempt number (1-based)
 * @returns Promise that resolves after the delay
 */
function waitRetryBackoff(attempt: number) {
  const base = 50 * 2 ** (attempt - 1);
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
    case Code.ResourceExhausted | Code.Unavailable:
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

  const [, action, resource] = match;
  return { operation: action.toLowerCase(), resourceType: resource };
}

/**
 * @internal
 * @param message - Request message to format
 * @returns Pretty-printed JSON or error placeholder
 */
export function formatRequestParams(message: unknown): string {
  try {
    if (message && typeof message === "object" && "toJson" in message) {
      return JSON.stringify((message as { toJson: () => unknown }).toJson(), null, 2);
    }
    return JSON.stringify(message, null, 2);
  } catch {
    return "(unable to serialize request)";
  }
}

/**
 * Fetch all paginated resources by repeatedly calling the given function.
 * @template T
 * @param fn - Page fetcher returning items and next page token
 * @returns All fetched items
 */
export async function fetchAll<T>(fn: (pageToken: string) => Promise<[T[], string]>) {
  const items: T[] = [];
  let pageToken = "";

  while (true) {
    const [batch, nextPageToken] = await fn(pageToken);
    items.push(...batch);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
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
 * Resolve "name:url" patterns to actual Static Website URLs.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param urls - URLs or name:url patterns
 * @param context - Logging context (e.g., "CORS", "OAuth2 redirect URIs")
 * @returns Resolved URLs
 */
export async function resolveStaticWebsiteUrls(
  client: OperatorClient,
  workspaceId: string,
  urls: string[] | undefined,
  context: string, // for logging context (e.g., "CORS", "OAuth2 redirect URIs")
): Promise<string[]> {
  if (!urls) {
    return [];
  }

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
          } else {
            logger.warn(
              `Static website "${siteName}" has no URL assigned yet. Excluding from ${context}.`,
            );
            return [];
          }
        } catch {
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
