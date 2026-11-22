import { CLIError } from "./errors";
import type { AuthInvokerObject } from "#/types/auth.generated";

/** A machine user named on the command line, optionally qualified by its Auth service. */
export interface MachineUserRef {
  authNamespace?: string;
  name: string;
}

/** A kind of thing an Auth service defines by name, such as a machine user. */
export interface AuthMemberKind {
  /** What it is called in messages, e.g. `machine user`. */
  noun: string;
  /** Prefix of its error codes, e.g. `MACHINE_USER`. */
  codePrefix: string;
  /** Key naming it in error context, e.g. `machineUser`. */
  contextKey: string;
  /** Where the config defines it, e.g. `auth.machineUsers`. */
  configField: string;
}

const MACHINE_USER: AuthMemberKind = {
  noun: "machine user",
  codePrefix: "MACHINE_USER",
  contextKey: "machineUser",
  configField: "auth.machineUsers",
};

function parseAuthMemberRef(value: string, kind: AuthMemberKind): MachineUserRef {
  const parts = value.split("/");
  const [first, second] = parts;
  if (parts.length === 1 && first) return { name: first };
  if (parts.length === 2 && first && second) return { authNamespace: first, name: second };
  throw CLIError({
    code: `${kind.codePrefix}_INVALID`,
    message: `${capitalized(kind.noun)} "${value}" is neither a name nor <auth>/<name>.`,
    suggestion: `Pass the ${kind.noun}'s name, or its Auth service and name as <auth>/<name>.`,
    context: { [kind.contextKey]: value },
  });
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Read a machine user value given as `<machine-user>` or `<auth>/<machine-user>`.
 * @param value - Machine user value from an option, the environment, or a profile
 * @returns The machine user name, with its Auth service when the value names one
 */
export function parseMachineUserRef(value: string): MachineUserRef {
  return parseAuthMemberRef(value, MACHINE_USER);
}

/**
 * Whether a profile that pins a machine user accepts one given by an option or the environment: the
 * same value, or the pinned machine user's name without the Auth service the pin names.
 * @param pinned - Machine user the profile pins
 * @param explicit - Machine user given by an option or the environment
 * @returns Whether the explicit value names the pinned machine user
 */
export function acceptsPinnedMachineUser(pinned: string, explicit: string): boolean {
  if (explicit === pinned) return true;
  const slash = pinned.indexOf("/");
  return slash !== -1 && explicit === pinned.slice(slash + 1);
}

/** An Auth service with the machine users it defines; `undefined` when they are not known. */
export interface MachineUserAuth {
  name: string;
  machineUsers: ReadonlyArray<string> | undefined;
}

/**
 * List the Auth services that define a machine user.
 * @param machineUser - Machine user name
 * @param auths - Auth services to look in
 * @returns Names of the Auth services that define it, in the given order
 */
export function authNamespacesDefining(
  machineUser: string,
  auths: ReadonlyArray<MachineUserAuth>,
): string[] {
  return auths.filter((auth) => auth.machineUsers?.includes(machineUser)).map(({ name }) => name);
}

export interface ResolveMachineUserParams {
  /** Machine user value: `<machine-user>` or `<auth>/<machine-user>`. */
  value: string;
  /** Auth services of the config. */
  auths: ReadonlyArray<MachineUserAuth>;
}

/** An Auth service with the members of one kind it defines; `undefined` when they are not known. */
export interface AuthMembers {
  name: string;
  members: ReadonlyArray<string> | undefined;
}

export interface ResolveAuthMemberParams {
  /** Member value: `<name>` or `<auth>/<name>`. */
  value: string;
  /** Auth services to look in. */
  auths: ReadonlyArray<AuthMembers>;
  /** Kind of member. */
  kind: AuthMemberKind;
}

function memberNotFound(
  kind: AuthMemberKind,
  name: string,
  authNamespaces: ReadonlyArray<string>,
  available: string[],
): CLIError {
  return CLIError({
    code: `${kind.codePrefix}_NOT_FOUND`,
    message:
      authNamespaces.length === 1
        ? `Auth service "${authNamespaces[0]}" defines no ${kind.noun} "${name}".`
        : `None of the Auth services ${authNamespaces.join(", ")} defines a ${kind.noun} "${name}".`,
    suggestion: available.length
      ? `Use one of the ${kind.noun}s: ${available.join(", ")}.`
      : `Define the ${kind.noun} in ${kind.configField}.`,
    context: { [kind.contextKey]: name, authNamespaces: [...authNamespaces], available },
  });
}

/**
 * Resolve the Auth service a member of a config's Auth services belongs to. A qualified value names
 * it; with one Auth service, a bare name belongs to that one; with several, to the one that
 * defines the name.
 * @param params - Member value, the Auth services to look in, and the kind of member
 * @returns Auth service and member name
 */
export function resolveAuthMember(params: ResolveAuthMemberParams): {
  authNamespace: string;
  name: string;
} {
  const { value, auths, kind } = params;
  const { authNamespace, name } = parseAuthMemberRef(value, kind);
  if (auths.length === 0) {
    throw CLIError({
      code: "AUTH_CONFIG_REQUIRED",
      message: "No Auth service configured.",
      suggestion: "Ensure tailor.config.ts has an auth config.",
    });
  }
  const authNames = auths.map((candidate) => candidate.name);
  if (authNamespace !== undefined) {
    const auth = auths.find((candidate) => candidate.name === authNamespace);
    if (!auth) {
      throw CLIError({
        code: "AUTH_NOT_FOUND",
        message: `${capitalized(kind.noun)} "${value}" names Auth service "${authNamespace}", which the config does not define.`,
        suggestion: `Use one of the Auth services: ${authNames.join(", ")}.`,
        context: { [kind.contextKey]: value, authNamespaces: authNames },
      });
    }
    if (auth.members && !auth.members.includes(name)) {
      throw memberNotFound(kind, name, [auth.name], [...auth.members]);
    }
    return { authNamespace: auth.name, name };
  }
  const [only, ...others] = auths;
  if (only && others.length === 0) return { authNamespace: only.name, name };
  const defining = auths.filter((auth) => auth.members?.includes(name)).map((auth) => auth.name);
  const [found, ...alsoDefining] = defining;
  if (found === undefined) {
    const available = [...new Set(auths.flatMap((auth) => auth.members ?? []))].toSorted();
    throw memberNotFound(kind, name, authNames, available);
  }
  if (alsoDefining.length > 0) {
    throw CLIError({
      code: `${kind.codePrefix}_AMBIGUOUS`,
      message: `${capitalized(kind.noun)} "${name}" is defined in several Auth services: ${defining.join(", ")}.`,
      suggestion: `Name the Auth service as <auth>/<name>, for example ${found}/${name}.`,
      context: { [`${kind.contextKey}s`]: [{ [kind.contextKey]: name, authNamespaces: defining }] },
    });
  }
  return { authNamespace: found, name };
}

/**
 * Resolve the Auth service a command runs a machine user as. A qualified value names it; with one
 * Auth service, a bare name runs as that one; with several, as the one that defines the name.
 * @param params - Machine user value and the config's Auth services
 * @returns Auth service and machine user name
 */
export function resolveMachineUser(params: ResolveMachineUserParams): AuthInvokerObject {
  const { authNamespace, name } = resolveAuthMember({
    value: params.value,
    auths: params.auths.map((auth) => ({ name: auth.name, members: auth.machineUsers })),
    kind: MACHINE_USER,
  });
  return { namespace: authNamespace, machineUserName: name };
}
