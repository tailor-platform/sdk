import { resolveAuthMember, type AuthMemberKind } from "#/cli/shared/machine-user";
import type { LoadedConfigFile } from "#/cli/shared/config-loader";

/** An Auth service with the OAuth2 clients it defines; `undefined` when they are not known. */
export interface OAuth2ClientAuth {
  name: string;
  oauth2Clients: ReadonlyArray<string> | undefined;
}

/**
 * Auth services of a config file with the OAuth2 clients each defines; an external Auth service's
 * OAuth2 clients are not known.
 * @param loaded - Loaded config file
 * @returns Auth services in declaration order
 */
export function oauth2ClientAuths(loaded: LoadedConfigFile): OAuth2ClientAuth[] {
  if (loaded.kind === "workspace") {
    return Object.entries(loaded.workspace.auth).map(([name, auth]) => ({
      name,
      oauth2Clients: Object.keys(auth.oauth2Clients ?? {}),
    }));
  }
  const { auth } = loaded.config;
  if (!auth) return [];
  if ("external" in auth) return [{ name: auth.name, oauth2Clients: undefined }];
  return [{ name: auth.name, oauth2Clients: Object.keys(auth.oauth2Clients ?? {}) }];
}

/** An OAuth2 client with the Auth service it belongs to. */
export interface OAuth2ClientRef {
  authNamespace: string;
  name: string;
}

export interface ResolveOAuth2ClientParams {
  /** OAuth2 client value: `<name>` or `<auth>/<name>`. */
  value: string;
  /** Auth services to look in. */
  auths: ReadonlyArray<OAuth2ClientAuth>;
}

const OAUTH2_CLIENT: AuthMemberKind = {
  noun: "OAuth2 client",
  codePrefix: "OAUTH2_CLIENT",
  contextKey: "oauth2Client",
  configField: "auth.oauth2Clients",
};

/**
 * Resolve the Auth service of an OAuth2 client. A qualified value names it; with one Auth service,
 * a bare name belongs to that one; with several, to the one that defines the name.
 * @param params - OAuth2 client value and the Auth services to look in
 * @returns Auth service and OAuth2 client name
 */
export function resolveOAuth2Client(params: ResolveOAuth2ClientParams): OAuth2ClientRef {
  return resolveAuthMember({
    value: params.value,
    auths: params.auths.map((auth) => ({ name: auth.name, members: auth.oauth2Clients })),
    kind: OAUTH2_CLIENT,
  });
}
