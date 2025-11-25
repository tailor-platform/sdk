import { PATScope } from "@tailor-proto/tailor/v1/auth_resource_pb";
import ml from "multiline-ts";
import { z } from "zod";
import type { PersonalAccessToken } from "@tailor-proto/tailor/v1/auth_resource_pb";

// Server validation pattern: ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$
// This requires minimum 3 characters (start + middle(1-61) + end)
const PAT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function validatePATName(name: string): void {
  if (!PAT_NAME_PATTERN.test(name)) {
    throw new Error(ml`
      Token name "${name}" is invalid.
      Name must:
        - Be 3-63 characters long
        - Start and end with a lowercase letter or number
        - Only contain lowercase letters, numbers, and hyphens
    `);
  }
}

export interface PersonalAccessTokenInfo {
  name: string;
  scopes: string[];
}

const patFormatSchema = z.enum(["text", "json"]);

export const patFormatArgs = {
  format: {
    type: "string",
    description: `Output format (${patFormatSchema.options.join(", ")})`,
    alias: "f",
    default: "text",
  },
} as const;

export function parsePATFormat(format: string) {
  const parsed = patFormatSchema.safeParse(format);
  if (!parsed.success) {
    throw new Error(
      `Format "${format}" is invalid. Must be one of: ${patFormatSchema.options.join(", ")}`,
    );
  }
  return parsed.data;
}

function patScopeToString(scope: PATScope): string {
  switch (scope) {
    case PATScope.PAT_SCOPE_READ:
      return "read";
    case PATScope.PAT_SCOPE_WRITE:
      return "write";
    default:
      return "unknown";
  }
}

export function transformPersonalAccessToken(
  pat: PersonalAccessToken,
): PersonalAccessTokenInfo {
  return {
    name: pat.name,
    scopes: pat.scopes.map(patScopeToString),
  };
}

export function getScopesFromWriteFlag(write: boolean): PATScope[] {
  return write
    ? [PATScope.PAT_SCOPE_READ, PATScope.PAT_SCOPE_WRITE]
    : [PATScope.PAT_SCOPE_READ];
}

function getScopeStringsFromWriteFlag(write: boolean): string[] {
  return write ? ["read", "write"] : ["read"];
}

export function printCreatedToken(
  name: string,
  token: string,
  write: boolean,
  format: "text" | "json",
  action: "created" | "updated",
): void {
  const scopes = getScopeStringsFromWriteFlag(write);

  if (format === "text") {
    console.log(ml`
      Personal access token ${action} successfully.

        name: ${name}
      scopes: ${scopes.join("/")}
       token: ${token}

      Please save this token in a secure location. You won't be able to see it again.
    `);
  } else {
    console.log(
      JSON.stringify({
        name,
        scopes,
        token,
      }),
    );
  }
}
