import { createClient, Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { GraphQLClient } from "graphql-request";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";

export function createOperatorClient() {
  const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";
  const workspaceId = process.env.WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error("WORKSPACE_ID is not defined");
  }

  const transport = createConnectTransport({
    httpVersion: "2",
    baseUrl,
    interceptors: [userAgentInterceptor(), bearerTokenInterceptor()],
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

function bearerTokenInterceptor(): Interceptor {
  const token = process.env.TAILOR_TOKEN;
  if (!token) {
    throw new Error("TAILOR_TOKEN is not defined");
  }

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
    // Prevent throwing errors on GraphQL errors.
    errorPolicy: "all",
  });
}
