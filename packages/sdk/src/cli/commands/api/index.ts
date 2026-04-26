import { arg } from "politty";
import { z } from "zod";
import { configArg, workspaceArgs } from "@/cli/shared/args";
import { platformBaseUrl, userAgent } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { CLIError } from "@/cli/shared/errors";
import { logger } from "@/cli/shared/logger";
import { mergeFieldEntries } from "./field-merge";
import { renderInspectJson, renderInspectText } from "./inspect";
import { extractMethodName, getMethodDescriptor, listMethodNames } from "./proto-reflect";
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

function getEndpointFieldNames(methodName: string): string[] {
  // Use localName so the presence check matches the keys mergeFieldEntries
  // and direct --body parsing write into the request body.
  const method = getMethodDescriptor(methodName);
  return method ? method.input.fields.map((f) => f.localName) : [];
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

/**
 * Parse a JSON body string as a plain object for field injection.
 * Returns undefined for invalid JSON or non-object values (null, arrays, primitives),
 * so callers can fall back to sending the raw string unchanged.
 * @param body - Raw body string
 * @returns Parsed object or undefined
 */
function parseBodyAsObject(body: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

export const apiCommand = defineAppCommand({
  name: "api",
  description: "Call Tailor Platform API endpoints directly.",
  notes: `Use \`--list\` to enumerate available methods and \`--inspect\` to print an endpoint's input message tree (combine with \`--json\` for machine-readable output).

Build the request body in one of two ways:

- \`--body\` accepts a JSON object string (escape hatch for arbitrary shapes including \`map\` fields and \`repeated\` of messages). \`bytes\` fields accept the raw base64 string via \`--field\` directly.
- \`--field <key>=<value>\` (repeatable, alias \`-f\`) sets fields one at a time. Supports dot-notation for nested messages (\`tailordbType.name=User\`) and repeats the same key to populate \`repeated\` scalar/enum fields. Values are coerced according to the proto field type. \`map\` fields, \`repeated\` of messages, and \`google.protobuf.*\` well-known types (Duration, Timestamp, FieldMask, …) have JSON encodings that cannot be assembled from \`--field\` entries; use \`--body\` for those.

When both are supplied, \`--body\` is the base and \`--field\` entries override on top.

Commonly required fields are auto-injected when not already set:

- \`workspaceId\` — resolved from \`-w\` / \`TAILOR_PLATFORM_WORKSPACE_ID\` / the selected profile.
- \`namespaceName\` — resolved from \`tailor.config.ts\` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use \`auth.name\`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.`,
  examples: [
    { cmd: "--list", desc: "List all available OperatorService methods." },
    { cmd: "GetApplication --inspect", desc: "Show the input message tree for an endpoint." },
    {
      cmd: "GetApplication --field applicationName=app-1",
      desc: "Call with a single field; workspaceId is auto-injected.",
    },
    {
      cmd: "CreateApplication -f applicationName=app -f cors=https://a -f cors=https://b",
      desc: "Use repeated --field for proto repeated fields.",
    },
    {
      cmd: "ListWorkspaces -b '{\"pageSize\":10}'",
      desc: "Use raw JSON body for advanced shapes.",
    },
  ],
  args: z
    .object({
      ...workspaceArgs,
      ...configArg,
      body: arg(z.string().default("{}"), {
        alias: "b",
        description: "Request body as JSON.",
      }),
      field: arg(z.array(z.string()).default([]), {
        alias: "f",
        description:
          "Set a request field as key=value. Repeatable. Supports dot-notation (e.g. tailordbType.name=User).",
      }),
      inspect: arg(z.boolean().default(false), {
        description:
          "Print the input message tree of the endpoint and exit without making a request.",
      }),
      list: arg(z.boolean().default(false), {
        description: "List all available OperatorService methods and exit.",
      }),
      endpoint: arg(z.string().optional(), {
        positional: true,
        description:
          "API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication').",
        completion: { custom: { choices: listMethodNames() } },
      }),
    })
    .strict(),
  run: async (args) => {
    if (args.list) {
      const names = listMethodNames();
      if (logger.jsonMode) {
        logger.out(names);
      } else {
        for (const name of names) logger.out(name);
      }
      return;
    }

    if (args.endpoint === undefined) {
      throw CLIError({
        message: "endpoint is required unless --list is given",
        command: "api",
      });
    }

    const endpoint = args.endpoint;
    const methodName = extractMethodName(endpoint);

    if (args.inspect) {
      const method = getMethodDescriptor(methodName);
      if (!method) {
        throw CLIError({
          message: `unknown method: ${methodName}`,
          suggestion: "Run `tailor-sdk api --list` to see available methods.",
          command: "api",
        });
      }
      if (logger.jsonMode) {
        logger.out(renderInspectJson(method));
      } else {
        logger.out(renderInspectText(method));
      }
      return;
    }

    const baseBody = parseBodyAsObject(args.body);

    let bodyForRequest = args.body;
    let parsedBody: Record<string, unknown> | undefined = baseBody;

    if (args.field.length > 0) {
      if (!parsedBody) {
        throw CLIError({
          message: "--field cannot be combined with a non-object --body",
          details: `--body must be a JSON object when --field is used; got: ${args.body}`,
          command: "api",
        });
      }
      const method = getMethodDescriptor(methodName);
      if (!method) {
        throw CLIError({
          message: `unknown method: ${methodName}`,
          suggestion: "Run `tailor-sdk api --list` to see available methods.",
          command: "api",
        });
      }
      const merged = mergeFieldEntries({
        body: parsedBody,
        entries: args.field,
        methodInput: method.input,
      });
      if (!merged.ok) {
        throw CLIError({
          message: "failed to apply --field entries",
          details: merged.error,
          command: "api",
        });
      }
      parsedBody = merged.body;
    }

    let mutated = args.field.length > 0;

    if (parsedBody) {
      const fieldNames = getEndpointFieldNames(methodName);

      if (fieldNames.includes("workspaceId") && !("workspaceId" in parsedBody)) {
        try {
          parsedBody.workspaceId = await loadWorkspaceId({
            workspaceId: args["workspace-id"],
            profile: args.profile,
          });
          mutated = true;
        } catch {
          // Cannot resolve workspace ID — skip
        }
      }

      if (fieldNames.includes("namespaceName") && !("namespaceName" in parsedBody)) {
        try {
          const { config } = await loadConfig(args.config);
          const ns = resolveNamespaceName(methodName, config);
          if (ns) {
            parsedBody.namespaceName = ns;
            mutated = true;
          }
        } catch {
          // Config not available — skip
        }
      }
    }

    if (mutated && parsedBody) {
      bodyForRequest = JSON.stringify(parsedBody);
    }

    const result = await apiCall({
      profile: args.profile,
      endpoint,
      body: bodyForRequest,
    });

    logger.log(JSON.stringify(result.data, null, 2));
  },
});
