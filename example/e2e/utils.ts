import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { GraphQLClient } from "graphql-request";
import { inject } from "vitest";

export function createOperatorClient() {
  const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";
  const workspaceId = inject("workspaceId");
  const platformToken = inject("platformToken");

  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl,
    interceptors: [
      userAgentInterceptor(),
      bearerTokenInterceptor(platformToken),
    ],
  });
  return [createClient(OperatorService, transport), workspaceId] as const;
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
