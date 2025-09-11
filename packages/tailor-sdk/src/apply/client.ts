import ml from "multiline-ts";
import { readPackageJSON } from "pkg-types";
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
import { type TailorctlConfig, writeTailorctlConfig } from "./tailorctl";

export type OperatorClient = Client<typeof OperatorService>;

export async function initOperatorClient(tailorctlConfig?: TailorctlConfig) {
  const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";

  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl,
    interceptors: [
      await userAgentInterceptor(),
      await bearerTokenInterceptor(baseUrl, tailorctlConfig),
      retryInterceptor(),
    ],
  });
  return createClient(OperatorService, transport);
}

async function userAgentInterceptor(): Promise<Interceptor> {
  const ua = await userAgent();
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    req.header.set("User-Agent", ua);
    return await next(req);
  };
}

async function userAgent() {
  const packageJson = await readPackageJSON(import.meta.url);
  return `tailor-sdk/${packageJson.version ?? "unknown"}`;
}

async function bearerTokenInterceptor(
  baseUrl: string,
  tailorctlConfig?: TailorctlConfig,
): Promise<Interceptor> {
  let token: string | undefined;
  if (process.env.TAILOR_TOKEN) {
    token = process.env.TAILOR_TOKEN;
  } else if (tailorctlConfig) {
    token = await refreshToken(baseUrl, tailorctlConfig);
  }
  if (token === undefined) {
    throw new Error(
      ml`
        Tailor token not found.
        Please set TAILOR_TOKEN environment variable, or configure it using tailorctl.
      `,
    );
  }

  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    req.header.set("Authorization", `Bearer ${token}`);
    return await next(req);
  };
}

async function refreshToken(baseUrl: string, config: TailorctlConfig) {
  // Refresh when invalid string (Invalid Date).
  const expiresAt = new Date(config.controlplanetokenexpiresat);
  const isExpired = !(expiresAt > new Date());
  if (!isExpired || !config.controlplanerefreshtoken) {
    return config.controlplaneaccesstoken;
  }

  const refreshUrl = new URL("/auth/platform/token/refresh", baseUrl).href;
  const formData = new URLSearchParams();
  formData.append("refresh_token", config.controlplanerefreshtoken);
  const resp = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      "User-Agent": await userAgent(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });
  if (!resp.ok) {
    throw new Error("Failed to refresh token");
  }
  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const newExpiresAt = new Date();
  newExpiresAt.setSeconds(newExpiresAt.getSeconds() + data.expires_in);
  const updatedConfig: TailorctlConfig = {
    ...config,
    controlplaneaccesstoken: data.access_token,
    controlplanerefreshtoken: data.refresh_token,
    controlplanetokenexpiresat: newExpiresAt.toISOString(),
  };
  writeTailorctlConfig(updatedConfig);
  return data.access_token;
}

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
        if (isRetryable(error, req.method.idempotency)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
}

function waitRetryBackoff(attempt: number) {
  const base = 50 * 2 ** (attempt - 1);
  const jitter = 0.1 * (Math.random() * 2 - 1);
  const backoff = base * (1 + jitter);
  return new Promise((resolve) => setTimeout(resolve, backoff));
}

function isRetryable(
  error: unknown,
  idempotency: MethodOptions_IdempotencyLevel,
) {
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

export async function fetchAll<T>(
  fn: (pageToken: string) => Promise<[T[], string]>,
) {
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

// Converting "name:url" patterns to actual Static Website URLs
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
            console.warn(
              `Static website "${siteName}" has no URL assigned yet. Excluding from ${context}.`,
            );
            return [];
          }
        } catch {
          console.warn(
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
