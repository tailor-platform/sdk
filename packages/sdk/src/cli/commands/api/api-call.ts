import { getPlatformBaseUrl, userAgent } from "#/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";

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
  const platformConfig = await loadPlatformClientConfig({
    profile: options.profile,
  });
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });

  let endpointPath: string;
  if (options.endpoint.includes("/")) {
    endpointPath = options.endpoint;
  } else {
    endpointPath = `tailor.v1.OperatorService/${options.endpoint}`;
  }

  const url = new URL(endpointPath, getPlatformBaseUrl(platformConfig));

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
