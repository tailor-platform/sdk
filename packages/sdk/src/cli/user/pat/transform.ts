import { PATScope } from "@tailor-proto/tailor/v1/auth_resource_pb";
import ml from "multiline-ts";
import type { PersonalAccessToken } from "@tailor-proto/tailor/v1/auth_resource_pb";

export interface PersonalAccessTokenInfo {
  name: string;
  scopes: string[];
}

export type PATOutputFormat = "text" | "json";

export function parsePATFormat(jsonFlag?: boolean): PATOutputFormat {
  return jsonFlag ? "json" : "text";
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
