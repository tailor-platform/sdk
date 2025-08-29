import ml from "multiline-ts";
import { readPackageJSON } from "pkg-types";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import {
  Client,
  Code,
  ConnectError,
  createClient,
  Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { TailorctlConfig } from "./tailorctl";

export type OperatorClient = Client<typeof OperatorService>;

export async function initOperatorClient(tailorctlConfig?: TailorctlConfig) {
  const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";

  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl,
    interceptors: [
      await userAgentInterceptor(),
      bearerTokenInterceptor(tailorctlConfig),
      retryInterceptor(),
    ],
  });
  return createClient(OperatorService, transport);
}

async function userAgentInterceptor(): Promise<Interceptor> {
  const packageJson = await readPackageJSON(import.meta.url);
  const userAgent = `tailor-sdk/${packageJson.version ?? "unknown"}`;

  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    req.header.set("User-Agent", userAgent);
    return await next(req);
  };
}

function bearerTokenInterceptor(
  tailorctlConfig?: TailorctlConfig,
): Interceptor {
  // TODO(remiposo): Refresh token when expired.
  const token =
    process.env.TAILOR_TOKEN ?? tailorctlConfig?.controlplaneaccesstoken;
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
