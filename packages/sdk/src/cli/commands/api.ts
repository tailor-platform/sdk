import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { arg } from "politty";
import { z } from "zod";
import { configArg, workspaceArgs } from "@/cli/shared/args";
import { platformBaseUrl, userAgent } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { LoadedConfig } from "@/cli/shared/config-loader";

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

function getEndpointFieldNames(methodName: string): string[] {
  const method = OperatorService.methods.find((m) => m.name === methodName);
  if (!method) return [];
  return method.input.fields.map((f) => f.jsonName);
}

function resolveNamespaceName(methodName: string, config: LoadedConfig): string | undefined {
  if (/Auth|Tenant|UserProfile/.test(methodName)) {
    return config.auth?.name;
  }
  if (/IdP/.test(methodName)) {
    if (config.idp?.length === 1) return config.idp[0].name;
    return undefined;
  }
  if (/TailorDB/.test(methodName)) {
    const keys = Object.keys(config.db ?? {});
    if (keys.length === 1) return keys[0];
    return undefined;
  }
  if (/Pipeline/.test(methodName)) {
    const keys = Object.keys(config.resolver ?? {});
    if (keys.length === 1) return keys[0];
    return undefined;
  }
  return undefined;
}

function injectFields(body: string, fields: Record<string, string>): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in parsed)) {
      parsed[key] = value;
    }
  }
  return JSON.stringify(parsed);
}

export const apiCommand = defineAppCommand({
  name: "api",
  description: "Call Tailor Platform API endpoints directly.",
  notes: `The request body is inferred from the proto definition of the target endpoint, and commonly required fields are auto-injected so they can be omitted from \`--body\`:

- \`workspaceId\` — resolved from \`-w\` / \`TAILOR_PLATFORM_WORKSPACE_ID\` / the selected profile.
- \`namespaceName\` — resolved from \`tailor.config.ts\` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use \`auth.name\`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

Values already present in \`--body\` are never overridden. If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.`,
  args: z
    .object({
      ...workspaceArgs,
      ...configArg,
      body: arg(z.string().default("{}"), {
        alias: "b",
        description: "Request body as JSON",
      }),
      endpoint: arg(z.string(), {
        positional: true,
        description:
          "API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication')",
      }),
    })
    .strict(),
  run: async (args) => {
    let body = args.body;

    const methodName = args.endpoint.includes("/")
      ? args.endpoint.split("/").pop()!
      : (args.endpoint as string);

    const fieldNames = getEndpointFieldNames(methodName);
    const fieldsToInject: Record<string, string> = {};

    if (fieldNames.includes("workspaceId")) {
      try {
        fieldsToInject.workspaceId = await loadWorkspaceId({
          workspaceId: args["workspace-id"],
          profile: args.profile,
        });
      } catch {
        // Cannot resolve workspace ID — skip
      }
    }

    if (fieldNames.includes("namespaceName")) {
      try {
        const { config } = await loadConfig(args.config);
        const ns = resolveNamespaceName(methodName, config);
        if (ns) fieldsToInject.namespaceName = ns;
      } catch {
        // Config not available — skip
      }
    }

    if (Object.keys(fieldsToInject).length > 0) {
      body = injectFields(body, fieldsToInject);
    }

    const result = await apiCall({
      profile: args.profile,
      endpoint: args.endpoint as string,
      body,
    });

    logger.log(JSON.stringify(result.data, null, 2));
  },
});
