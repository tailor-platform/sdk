import { arg } from "politty";
import { z } from "zod";
import { configArg, workspaceArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { apiCall } from "./api-call";
import { inspectCommand } from "./inspect";
import { listCommand } from "./list";
import { extractMethodName, getMethodDescriptor, listMethodNames } from "./proto-reflect";
import type { LoadedConfig } from "@/cli/shared/config-loader";

export { apiCall, type ApiCallOptions, type ApiCallResult } from "./api-call";

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
  notes: `Use \`tailor-sdk api list\` to enumerate invocable methods and \`tailor-sdk api inspect <endpoint>\` to print an endpoint's input message tree (combine with \`--json\` for machine-readable output).

The request body is inferred from the proto definition of the target endpoint, and commonly required fields are auto-injected so they can be omitted from \`--body\`:

- \`workspaceId\` — resolved from \`-w\` / \`TAILOR_PLATFORM_WORKSPACE_ID\` / the selected profile.
- \`namespaceName\` — resolved from \`tailor.config.ts\` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use \`auth.name\`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

Values already present in \`--body\` are never overridden. If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.`,
  examples: [
    {
      cmd: 'GetApplication -b \'{"applicationName":"app-1"}\'',
      desc: "Call an endpoint; workspaceId is auto-injected.",
    },
    {
      cmd: "list",
      desc: "List all invocable OperatorService methods.",
    },
    {
      cmd: "inspect GetApplication",
      desc: "Show the input message tree for an endpoint.",
    },
  ],
  subCommands: {
    list: listCommand,
    inspect: inspectCommand,
  },
  args: z
    .object({
      ...workspaceArgs,
      ...configArg,
      body: arg(z.string().default("{}"), {
        alias: "b",
        description: "Request body as JSON.",
      }),
      endpoint: arg(z.string(), {
        positional: true,
        description:
          "API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication').",
        completion: { custom: { choices: listMethodNames() } },
      }),
    })
    .strict(),
  run: async (args) => {
    const methodName = extractMethodName(args.endpoint);
    const method = getMethodDescriptor(methodName);

    const parsedBody = parseBodyAsObject(args.body);
    let mutated = false;

    if (parsedBody && method) {
      // Use localName so the presence check matches the keys --body parsing
      // writes into the request body.
      const fieldNames = method.input.fields.map((f) => f.localName);

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

    const result = await apiCall({
      profile: args.profile,
      endpoint: args.endpoint,
      body: mutated && parsedBody ? JSON.stringify(parsedBody) : args.body,
    });

    logger.log(JSON.stringify(result.data, null, 2));
  },
});
