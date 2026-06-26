import { getPlatformBaseUrl, userAgent, type PlatformClientConfig } from "#/cli/shared/client";
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

function hasEnvAccessToken(): boolean {
  return process.env.TAILOR_PLATFORM_TOKEN !== undefined || process.env.TAILOR_TOKEN !== undefined;
}

/**
 * Call Tailor Platform API endpoints directly.
 * If the endpoint doesn't contain "/", it defaults to `tailor.v1.OperatorService/{endpoint}`.
 * @param options - API call options (profile, endpoint, body)
 * @returns Response status and data
 */
export async function apiCall(options: ApiCallOptions): Promise<ApiCallResult> {
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  let platformConfig: PlatformClientConfig | undefined;
  try {
    platformConfig = await loadPlatformClientConfig({
      profile: options.profile,
    });
  } catch (error) {
    if (!hasEnvAccessToken()) throw error;
  }

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
