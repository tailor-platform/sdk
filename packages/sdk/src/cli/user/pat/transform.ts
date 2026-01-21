import { PATScope } from "@tailor-proto/tailor/v1/auth_resource_pb";
import ml from "multiline-ts";
import { logger } from "../../utils/logger";
import type { PersonalAccessToken } from "@tailor-proto/tailor/v1/auth_resource_pb";

export interface PersonalAccessTokenInfo {
  name: string;
  scopes: string[];
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

/**
 * Transform a PersonalAccessToken into CLI-friendly info.
 * @param pat - Personal access token resource
 * @returns Flattened token info
 */
export function transformPersonalAccessToken(pat: PersonalAccessToken): PersonalAccessTokenInfo {
  return {
    name: pat.name,
    scopes: pat.scopes.map(patScopeToString),
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
    logger.log(ml`
      Personal access token ${action} successfully.

        name: ${name}
      scopes: ${scopes.join("/")}
       token: ${token}

      Please save this token in a secure location. You won't be able to see it again.
    `);
  }
}
