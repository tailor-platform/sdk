import { isSdkBranded } from "#/utils/brand";
import { AppConfigSchema, AppDefinitionSchema, WorkspaceConfigSchema } from "./schema";
import type { AppConfig, AppDefinition, EnvEntry, WorkspaceConfig } from "#/configure/config/types";
import type { WorkspaceApplication, WorkspaceRepresentation } from "./types";
import type { z } from "zod";

/** The default export of `tailor.config.ts`, told apart by the function that defined it. */
export type ParsedConfigExport =
  | { kind: "config"; config: AppConfig }
  | {
      kind: "workspace";
      definedBy: "defineWorkspace" | "defineApp";
      workspace: WorkspaceRepresentation;
    };

type EnvOverride = Record<string, EnvEntry>;

type ParseResult =
  | { success: true; data: ParsedConfigExport }
  | { success: false; error: z.ZodError };

export type WorkspaceExport = Extract<ParsedConfigExport, { kind: "workspace" }>;

/**
 * List the `env` overrides of a workspace with the path of the service that holds each, as the
 * config spells it.
 * @param parsed - Parsed workspace config and the function that defined it
 * @returns Each override with its service path, e.g. `["resolver", "shop-api"]`
 */
export function envOverrideEntries<Value>(
  parsed: Pick<WorkspaceExport, "definedBy"> & { workspace: WorkspaceRepresentation<Value> },
): { servicePath: string[]; env: Record<string, Value> }[] {
  const { resolver, executor, workflow, auth } = parsed.workspace.envOverrides;
  return [
    ...Object.entries(resolver).map(([name, env]) => ({ servicePath: ["resolver", name], env })),
    ...(executor ? [{ servicePath: ["executor"], env: executor }] : []),
    ...(workflow ? [{ servicePath: ["workflow"], env: workflow }] : []),
    ...Object.entries(auth).map(([name, env]) => {
      const key = singleServiceKey(parsed.definedBy, name);
      return { servicePath: key === undefined ? ["auth"] : ["auth", key], env };
    }),
  ];
}

/**
 * The key an auth or IdP of a workspace is written under in its config: its name in
 * `defineWorkspace()`, and none in `defineApp()`, which takes a single auth and a single IdP.
 * @param definedBy - Function that defined the config
 * @param name - Name of the auth or IdP
 * @returns The key, or undefined for a `defineApp()` config
 */
export function singleServiceKey(
  definedBy: WorkspaceExport["definedBy"],
  name: string,
): string | undefined {
  return definedBy === "defineApp" ? undefined : name;
}

/**
 * Map every `env` override of a workspace to new values.
 * @param overrides - The workspace's `env` overrides
 * @param map - Maps one service's override to its new values
 * @returns The overrides with mapped values
 */
export function mapEnvOverrides<From, To>(
  overrides: WorkspaceRepresentation<From>["envOverrides"],
  map: (env: Record<string, From>) => Record<string, To>,
): WorkspaceRepresentation<To>["envOverrides"] {
  const mapEach = (records: Record<string, Record<string, From>>) =>
    Object.fromEntries(Object.entries(records).map(([name, env]) => [name, map(env)]));
  return {
    resolver: mapEach(overrides.resolver),
    ...(overrides.executor ? { executor: map(overrides.executor) } : {}),
    ...(overrides.workflow ? { workflow: map(overrides.workflow) } : {}),
    auth: mapEach(overrides.auth),
  };
}

function withoutEnv<Entry extends object>(entry: Entry): [Omit<Entry, "env">, EnvOverride?] {
  if (!("env" in entry)) return [entry];
  const { env, ...rest } = entry as Entry & { env?: EnvOverride };
  return [rest, env];
}

function splitEnv<Entry extends object>(
  entries: Record<string, Entry>,
): [Record<string, Omit<Entry, "env">>, Record<string, EnvOverride>] {
  const services: Record<string, Omit<Entry, "env">> = {};
  const overrides: Record<string, EnvOverride> = {};
  for (const [name, entry] of Object.entries(entries)) {
    const [service, env] = withoutEnv(entry);
    services[name] = service;
    if (env !== undefined) overrides[name] = env;
  }
  return [services, overrides];
}

function toWorkspace(config: WorkspaceConfig): WorkspaceRepresentation {
  const { env, db, resolver, executor, workflow, auth, idp, apps, ...settings } = config;
  const [resolverServices, resolverOverrides] = splitEnv(resolver ?? {});
  const [authServices, authOverrides] = splitEnv(auth ?? {});
  const [executorService, executorOverride] = executor ? withoutEnv(executor) : [];
  const [workflowService, workflowOverride] = workflow ? withoutEnv(workflow) : [];
  return {
    ...settings,
    env: env ?? {},
    db: db ?? {},
    resolver: resolverServices,
    ...(executorService ? { executor: executorService } : {}),
    ...(workflowService ? { workflow: workflowService } : {}),
    auth: authServices,
    idp: idp ?? {},
    envOverrides: {
      resolver: resolverOverrides,
      ...(executorOverride ? { executor: executorOverride } : {}),
      ...(workflowOverride ? { workflow: workflowOverride } : {}),
      auth: authOverrides,
    },
    apps: Object.fromEntries(
      Object.entries(apps).map(
        ([name, { db: appDb, resolver: appResolver, idp: appIdp, ...app }]) => {
          const application: WorkspaceApplication = {
            ...app,
            db: [...(appDb ?? [])],
            resolver: [...(appResolver ?? [])],
          };
          const [exposedIdp] = appIdp ?? [];
          if (exposedIdp !== undefined) application.idp = exposedIdp;
          return [name, application];
        },
      ),
    ),
  };
}

function appToWorkspace(app: AppDefinition): WorkspaceConfig {
  const {
    name,
    cors,
    allowedIpAddresses,
    disableIntrospection,
    metadata,
    db,
    resolver,
    auth,
    idp,
    ...workspace
  } = app;
  return {
    ...workspace,
    ...(db ? { db } : {}),
    ...(resolver ? { resolver } : {}),
    ...(auth ? { auth: { [auth.name]: auth } } : {}),
    ...(idp ? { idp: { [idp.name]: idp } } : {}),
    apps: {
      [name]: {
        ...(cors ? { cors } : {}),
        ...(allowedIpAddresses ? { allowedIpAddresses } : {}),
        ...(disableIntrospection !== undefined ? { disableIntrospection } : {}),
        ...(metadata ? { metadata } : {}),
        db: Object.keys(db ?? {}),
        resolver: Object.keys(resolver ?? {}),
        ...(auth ? { auth: auth.name } : {}),
        ...(idp ? { idp: [idp.name] } : {}),
      },
    },
  };
}

/**
 * Validate the default export of `tailor.config.ts` and tell which function defined it.
 * A `defineApp()` config is converted to the workspace shape it stands for.
 * @param value - Default export of the config module
 * @returns The parsed config, or the validation error
 */
export function parseConfigExport(value: unknown): ParseResult {
  if (isSdkBranded(value, "workspace-config")) {
    const result = WorkspaceConfigSchema.safeParse(value);
    if (!result.success) return result;
    return {
      success: true,
      data: {
        kind: "workspace",
        definedBy: "defineWorkspace",
        workspace: toWorkspace(value as WorkspaceConfig),
      },
    };
  }
  if (isSdkBranded(value, "app-config")) {
    const result = AppDefinitionSchema.safeParse(value);
    if (!result.success) return result;
    return {
      success: true,
      data: {
        kind: "workspace",
        definedBy: "defineApp",
        workspace: toWorkspace(appToWorkspace(value as AppDefinition)),
      },
    };
  }
  const result = AppConfigSchema.safeParse(value);
  if (!result.success) return result;
  return { success: true, data: { kind: "config", config: value as AppConfig } };
}
