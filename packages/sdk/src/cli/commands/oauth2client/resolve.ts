import { CLIError } from "#/cli/shared/errors";
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

function parseOAuth2ClientRef(value: string): Partial<OAuth2ClientRef> & { name: string } {
  const parts = value.split("/");
  const [first, second] = parts;
  if (parts.length === 1 && first) return { name: first };
  if (parts.length === 2 && first && second) return { authNamespace: first, name: second };
  throw CLIError({
    code: "OAUTH2_CLIENT_INVALID",
    message: `OAuth2 client "${value}" is neither a name nor <auth>/<name>.`,
    suggestion: "Pass the OAuth2 client's name, or its Auth service and name as <auth>/<name>.",
    context: { oauth2Client: value },
  });
}

function oauth2ClientNotFound(
  name: string,
  authNamespaces: ReadonlyArray<string>,
  known: string[],
): CLIError {
  return CLIError({
    code: "OAUTH2_CLIENT_NOT_FOUND",
    message:
      authNamespaces.length === 1
        ? `Auth service "${authNamespaces[0]}" defines no OAuth2 client "${name}".`
        : `None of the Auth services ${authNamespaces.join(", ")} defines an OAuth2 client "${name}".`,
    suggestion: known.length
      ? `Use one of the OAuth2 clients: ${known.join(", ")}.`
      : "Define the OAuth2 client in auth.oauth2Clients.",
    context: { oauth2Client: name, authNamespaces: [...authNamespaces], oauth2Clients: known },
  });
}

export interface ResolveOAuth2ClientParams {
  /** OAuth2 client value: `<name>` or `<auth>/<name>`. */
  value: string;
  /** Auth services to look in. */
  auths: ReadonlyArray<OAuth2ClientAuth>;
}

/**
 * Resolve the Auth service of an OAuth2 client. A qualified value names it; with one Auth service,
 * a bare name belongs to that one; with several, to the one that defines the name.
 * @param params - OAuth2 client value and the Auth services to look in
 * @returns Auth service and OAuth2 client name
 */
export function resolveOAuth2Client(params: ResolveOAuth2ClientParams): OAuth2ClientRef {
  const { value, auths } = params;
  const { authNamespace, name } = parseOAuth2ClientRef(value);
  if (auths.length === 0) {
    throw CLIError({
      code: "AUTH_CONFIG_REQUIRED",
      message: "No Auth service configured.",
      suggestion: "Ensure tailor.config.ts has an auth config.",
    });
  }
  if (authNamespace !== undefined) {
    const auth = auths.find((candidate) => candidate.name === authNamespace);
    if (!auth) {
      throw CLIError({
        code: "AUTH_NOT_FOUND",
        message: `OAuth2 client "${value}" names Auth service "${authNamespace}", which the config does not define.`,
        suggestion: `Use one of the Auth services: ${auths.map((candidate) => candidate.name).join(", ")}.`,
        context: { oauth2Client: value, authNamespaces: auths.map((candidate) => candidate.name) },
      });
    }
    if (auth.oauth2Clients && !auth.oauth2Clients.includes(name)) {
      throw oauth2ClientNotFound(name, [auth.name], [...auth.oauth2Clients]);
    }
    return { authNamespace: auth.name, name };
  }
  const [only, ...others] = auths;
  if (only && others.length === 0) return { authNamespace: only.name, name };
  const defining = auths
    .filter((auth) => auth.oauth2Clients?.includes(name))
    .map((auth) => auth.name);
  const [found, ...alsoDefining] = defining;
  if (found === undefined) {
    const known = [...new Set(auths.flatMap((auth) => auth.oauth2Clients ?? []))].toSorted();
    throw oauth2ClientNotFound(
      name,
      auths.map((auth) => auth.name),
      known,
    );
  }
  if (alsoDefining.length > 0) {
    throw CLIError({
      code: "OAUTH2_CLIENT_AMBIGUOUS",
      message: `OAuth2 client "${name}" is defined in several Auth services: ${defining.join(", ")}.`,
      suggestion: `Name the Auth service as <auth>/<name>, for example ${found}/${name}.`,
      context: { oauth2Client: name, authNamespaces: defining },
    });
  }
  return { authNamespace: found, name };
}
