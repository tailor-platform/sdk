import { PATScope } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { formatTimestamp } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { protoEnumLookup } from "#/cli/shared/proto-enum";
import ml from "#/utils/multiline";
import type { PersonalAccessToken } from "@tailor-platform/tailor-proto/auth_resource_pb";

export interface PersonalAccessTokenInfo {
  name: string;
  scopes: string[];
  createdAt: Date | null;
  /** `null` until the token has been used to authenticate. */
  lastUsedAt: Date | null;
}

const PAT_SCOPE_LABEL = {
  [PATScope.PAT_SCOPE_UNSPECIFIED]: "unknown",
  [PATScope.PAT_SCOPE_READ]: "read",
  [PATScope.PAT_SCOPE_WRITE]: "write",
} satisfies Record<PATScope, string>;

function patScopeToString(scope: PATScope): string {
  return protoEnumLookup(PAT_SCOPE_LABEL, scope, "unknown");
}

/**
 * Transform a PersonalAccessToken into CLI-friendly info.
 * @param pat - Personal access token resource
 * @returns Flattened token info
 */
export function transformPersonalAccessToken(pat: PersonalAccessToken): PersonalAccessTokenInfo {
  return {
    name: pat.name,
    scopes: pat.scopes.map(patScopeToString),
    createdAt: formatTimestamp(pat.createdAt),
    lastUsedAt: formatTimestamp(pat.lastUsedAt),
  };
}

/**
 * Get PAT scopes from a write flag.
 * @param write - Whether write access is required
 * @returns Scopes to apply to the token
 */
export function getScopesFromWriteFlag(write: boolean): PATScope[] {
  return write ? [PATScope.PAT_SCOPE_READ, PATScope.PAT_SCOPE_WRITE] : [PATScope.PAT_SCOPE_READ];
}

function getScopeStringsFromWriteFlag(write: boolean): string[] {
  return write ? ["read", "write"] : ["read"];
}

/**
 * Print the created or updated personal access token to the logger.
 * @param name - Token name
 * @param token - Token value
 * @param write - Whether the token has write scope
 * @param action - Action performed
 */
export function printCreatedToken(
  name: string,
  token: string,
  write: boolean,
  action: "created" | "updated",
): void {
  const scopes = getScopeStringsFromWriteFlag(write);

  if (logger.jsonMode) {
    logger.out({ name, scopes, token });
  } else {
    logger.out(ml`
      Personal access token ${action} successfully.

        name: ${name}
      scopes: ${scopes.join("/")}
       token: ${token}

      Please save this token in a secure location. You won't be able to see it again.
    `);
  }
}
