import { CLIError } from "./errors";
import type { AuthInvokerObject } from "#/types/auth.generated";

/** A machine user named on the command line, optionally qualified by its Auth service. */
export interface MachineUserRef {
  authNamespace?: string;
  name: string;
}

/**
 * Read a machine user value given as `<machine-user>` or `<auth>/<machine-user>`.
 * @param value - Machine user value from an option, the environment, or a profile
 * @returns The machine user name, with its Auth service when the value names one
 */
export function parseMachineUserRef(value: string): MachineUserRef {
  const parts = value.split("/");
  const [first, second] = parts;
  if (parts.length === 1 && first) return { name: first };
  if (parts.length === 2 && first && second) return { authNamespace: first, name: second };
  throw CLIError({
    code: "MACHINE_USER_INVALID",
    message: `Machine user "${value}" is neither a name nor <auth>/<name>.`,
    suggestion: "Pass the machine user's name, or its Auth service and name as <auth>/<name>.",
    context: { machineUser: value },
  });
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

function machineUserNotFound(name: string, authNamespaces: ReadonlyArray<string>, known: string[]) {
  return CLIError({
    code: "MACHINE_USER_NOT_FOUND",
    message:
      authNamespaces.length === 1
        ? `Auth service "${authNamespaces[0]}" defines no machine user "${name}".`
        : `None of the Auth services ${authNamespaces.join(", ")} defines a machine user "${name}".`,
    suggestion: known.length
      ? `Use one of the machine users: ${known.join(", ")}.`
      : "Define the machine user in auth.machineUsers.",
    context: { machineUser: name, authNamespaces: [...authNamespaces], machineUsers: known },
  });
}

/**
 * Resolve the Auth service a command runs a machine user as. A qualified value names it; with one
 * Auth service, a bare name runs as that one; with several, as the one that defines the name.
 * @param params - Machine user value and the config's Auth services
 * @returns Auth service and machine user name
 */
export function resolveMachineUser(params: ResolveMachineUserParams): AuthInvokerObject {
  const { value, auths } = params;
  const { authNamespace, name } = parseMachineUserRef(value);
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
        message: `Machine user "${value}" names Auth service "${authNamespace}", which the config does not define.`,
        suggestion: `Use one of the Auth services: ${auths.map((candidate) => candidate.name).join(", ")}.`,
        context: { machineUser: value, authNamespaces: auths.map((candidate) => candidate.name) },
      });
    }
    if (auth.machineUsers && !auth.machineUsers.includes(name)) {
      throw machineUserNotFound(name, [auth.name], [...auth.machineUsers]);
    }
    return { namespace: auth.name, machineUserName: name };
  }
  const [only, ...others] = auths;
  if (only && others.length === 0) return { namespace: only.name, machineUserName: name };
  const defining = authNamespacesDefining(name, auths);
  const [found, ...alsoDefining] = defining;
  if (found === undefined) {
    const known = [...new Set(auths.flatMap((auth) => auth.machineUsers ?? []))].toSorted();
    throw machineUserNotFound(
      name,
      auths.map((auth) => auth.name),
      known,
    );
  }
  if (alsoDefining.length > 0) {
    throw CLIError({
      code: "MACHINE_USER_AMBIGUOUS",
      message: `Machine user "${name}" is defined in several Auth services: ${defining.join(", ")}.`,
      suggestion: `Name the Auth service as <auth>/<name>, for example ${found}/${name}.`,
      context: { machineUsers: [{ machineUser: name, authNamespaces: defining }] },
    });
  }
  return { namespace: found, machineUserName: name };
}
