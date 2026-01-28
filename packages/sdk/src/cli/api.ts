import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "./args";
import { platformBaseUrl, userAgent } from "./client";
import { loadAccessToken } from "./context";
import { logger } from "./utils/logger";

export interface ApiCallOptions {
  profile?: string;
  endpoint: string;
  body?: string;
}

export interface ApiCallResult {
  status: number;
  data: unknown;
}

/**
 * Call Tailor Platform API endpoints directly.
 * If the endpoint doesn't contain "/", it defaults to `tailor.v1.OperatorService/{endpoint}`.
 * @param options - API call options (profile, endpoint, body)
 * @returns Response status and data
 */
export async function apiCall(options: ApiCallOptions): Promise<ApiCallResult> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });

  // Determine the endpoint path
  let endpointPath: string;
  if (options.endpoint.includes("/")) {
    endpointPath = options.endpoint;
  } else {
    // Default to OperatorService if no "/" in endpoint
    endpointPath = `tailor.v1.OperatorService/${options.endpoint}`;
  }

  // Build the full URL
  const url = new URL(endpointPath, platformBaseUrl);

  // Make the request
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": await userAgent(),
    },
    body: options.body ?? "{}",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API call failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return {
    status: response.status,
    data,
  };
}

export const apiCommand = defineCommand({
  name: "api",
  description: "Call Tailor Platform API endpoints directly",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    body: arg(z.string().default("{}"), { alias: "b", description: "Request body as JSON" }),
    endpoint: arg(z.string(), {
      positional: true,
      description:
        "API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication')",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const result = await apiCall({
      profile: args.profile,
      endpoint: args.endpoint as string,
      body: args.body,
    });

    if (args.json) {
      logger.log(JSON.stringify(result.data, null, 2));
    } else {
      logger.log(JSON.stringify(result.data, null, 2));
    }
  }),
});
