import { ScalarType } from "@bufbuild/protobuf";
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
import {
  enumerateAllFieldCompletions,
  extractMethodName,
  getMethodDescriptor,
  listMethodChoices,
  resolveLeafField,
} from "./proto-reflect";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { DescField } from "@bufbuild/protobuf";

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

/**
 * Set a dotted path on a body object, replacing non-object intermediates as
 * needed. `--field` takes precedence over `--body`, so collisions overwrite.
 * @param obj - The body object to mutate
 * @param path - Dot-split path segments (e.g. ["application", "name"])
 * @param value - Value to assign at the leaf
 */
function setNestedPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

/**
 * Coerces a raw `--field` string value to match the leaf proto type so the
 * JSON body sends a properly typed value. Today we only coerce bool — the
 * completion candidates explicitly suggest `=true`/`=false`, so sending the
 * literal string "true" would be a visible mismatch. Other scalars are left
 * as strings: proto JSON accepts string forms for ints/floats/int64/etc.,
 * and we'd rather pass through what the user typed than silently coerce.
 * @param field - The resolved leaf field descriptor, or undefined when the path didn't resolve
 * @param raw - The raw string value after `=`
 * @returns The value to write into the body object
 */
function coerceFieldValue(field: DescField | undefined, raw: string): unknown {
  if (field && field.fieldKind === "scalar" && field.scalar === ScalarType.BOOL) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Invalid value for bool field: '${raw}'. Expected 'true' or 'false'.`);
  }
  return raw;
}

interface ParsedField {
  path: string[];
  value: string;
}

// Prototype-pollution sinks: `setNestedPath` walks `cursor[key]`, so a
// segment that resolves on `Object.prototype` (e.g. `__proto__`) would let an
// untrusted dotted key mutate the runtime prototype instead of the body.
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const fieldArg = z.string().transform((val, ctx): ParsedField => {
  const eq = val.indexOf("=");
  if (eq < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid field format: '${val}'. Expected format: 'key=value' or 'a.b.c=value'`,
    });
    return z.NEVER;
  }
  const key = val.slice(0, eq);
  if (key.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Field key cannot be empty" });
    return z.NEVER;
  }
  const segments = key.split(".");
  if (segments.some((seg) => seg.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid field key: '${key}'. Dotted segments cannot be empty`,
    });
    return z.NEVER;
  }
  const forbidden = segments.find((seg) => FORBIDDEN_SEGMENTS.has(seg));
  if (forbidden) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid field key: '${key}'. Segment '${forbidden}' is not allowed.`,
    });
    return z.NEVER;
  }
  return { path: segments, value: val.slice(eq + 1) };
});

export const apiCommand = defineAppCommand({
  name: "api",
  description: "Call Tailor Platform API endpoints directly.",
  notes: `Use \`tailor-sdk api list\` to enumerate invocable methods and \`tailor-sdk api inspect <endpoint>\` to print an endpoint's input message tree (combine with \`--json\` for machine-readable output).

The request body is inferred from the proto definition of the target endpoint, and commonly required fields are auto-injected so they can be omitted from \`--body\`:

- \`workspaceId\` — resolved from \`-w\` / \`TAILOR_PLATFORM_WORKSPACE_ID\` / the selected profile.
- \`namespaceName\` — resolved from \`tailor.config.ts\` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use \`auth.name\`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

Values already present in \`--body\` are never overridden. If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.

Use \`--field key=value\` (repeatable) to set request body fields without writing JSON. Dotted keys (e.g. \`application.name=foo\`) build nested objects. \`--field\` overrides matching fields in \`--body\` and tab-completes from the endpoint's proto schema.`,
  examples: [
    {
      cmd: 'GetApplication -b \'{"applicationName":"app-1"}\'',
      desc: "Call an endpoint; workspaceId is auto-injected.",
    },
    {
      cmd: "GetApplication -f applicationName=app-1",
      desc: "Same as above, using --field instead of --body.",
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
      field: arg(fieldArg.array().optional(), {
        alias: "f",
        description:
          "Set a body field as `key=value` (repeatable; dotted keys nest). Overrides --body.",
        completion: {
          custom: {
            expand: {
              dependsOn: ["endpoint"],
              enumerate: ({ endpoint }) =>
                enumerateAllFieldCompletions(extractMethodName(endpoint ?? "")),
            },
          },
        },
      }),
      endpoint: arg(z.string(), {
        positional: true,
        description:
          "API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication').",
        completion: { custom: { choices: listMethodChoices() } },
      }),
    })
    .strict(),
  run: async (args) => {
    const methodName = extractMethodName(args.endpoint);
    const method = getMethodDescriptor(methodName);

    const parsedBody = parseBodyAsObject(args.body);
    let mutated = false;

    if (args.field && args.field.length > 0) {
      if (!parsedBody) {
        throw new Error("--field requires --body to be a JSON object (or omitted).");
      }
      for (const f of args.field) {
        const leaf = method ? resolveLeafField(method.input, f.path) : undefined;
        setNestedPath(parsedBody, f.path, coerceFieldValue(leaf, f.value));
      }
      mutated = true;
    }

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
