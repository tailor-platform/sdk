import { Code, ConnectError, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { GraphQLClient } from "graphql-request";
import { inject } from "vitest";

export function createOperatorClient() {
  const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";
  const workspaceId = inject("workspaceId");
  const platformToken = inject("platformToken");

  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl,
    // Every OperatorService call in e2e is a read (get*/list*), so a stalled
    // request is safe to cut short and retry instead of eating the test timeout.
    interceptors: [
      retryInterceptor(),
      userAgentInterceptor(),
      bearerTokenInterceptor(platformToken),
    ],
  });
  return [createClient(OperatorService, transport), workspaceId] as const;
}

// The per-attempt deadline lives here rather than in the transport's
// `defaultTimeoutMs`: the transport creates its deadline signal once per RPC,
// so after a timeout every retry would reuse an already-aborted request.
function retryInterceptor(maxAttempts = 3, attemptTimeoutMs = 10_000): Interceptor {
  const retryableCodes = new Set([Code.DeadlineExceeded, Code.Unavailable]);
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
      const deadline = new AbortController();
      const timer = setTimeout(
        () => deadline.abort(new ConnectError("attempt timed out", Code.DeadlineExceeded)),
        attemptTimeoutMs,
      );
      try {
        return await next({ ...req, signal: AbortSignal.any([req.signal, deadline.signal]) });
      } catch (error) {
        if (!retryableCodes.has(ConnectError.from(error).code)) {
          throw error;
        }
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  };
}

function userAgentInterceptor(): Interceptor {
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    req.header.set("User-Agent", "tailor-sdk-ci");
    return await next(req);
  };
}

function bearerTokenInterceptor(token: string): Interceptor {
  return (next) => async (req) => {
    if (req.stream) {
      return await next(req);
    }

    req.header.set("Authorization", `Bearer ${token}`);
    return await next(req);
  };
}

export function createGraphQLClient(appUrl: string, token: string) {
  const endpoint = new URL("/query", appUrl).href;
  return new GraphQLClient(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    errorPolicy: "all",
  });
}
