import ml from "multiline-ts";
import { readPackageJSON } from "pkg-types";
import { Client, createClient, Interceptor } from "@connectrpc/connect";
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
      // TODO(remiposo): Add retry interceptor.
      await userAgentInterceptor(),
      bearerTokenInterceptor(tailorctlConfig),
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
