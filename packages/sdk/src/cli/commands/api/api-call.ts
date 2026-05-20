import { platformBaseUrl, userAgent } from "@/cli/shared/client";
import { loadAccessToken } from "@/cli/shared/context";

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

  let endpointPath: string;
  if (options.endpoint.includes("/")) {
    endpointPath = options.endpoint;
  } else {
    endpointPath = `tailor.v1.OperatorService/${options.endpoint}`;
  }

  const url = new URL(endpointPath, platformBaseUrl);

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
