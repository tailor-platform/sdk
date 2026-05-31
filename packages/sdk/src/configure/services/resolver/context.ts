import { unauthenticatedTailorUser } from "@/types/user";
import type { TailorEnv } from "@/types/env";
import type { TailorInvoker, TailorUser } from "@/types/user";

type AuthenticatedPrincipal = NonNullable<TailorInvoker>;

/** The normalized resolver caller type. */
export type ResolverCallerType = "anonymous" | AuthenticatedPrincipal["type"];

/** A compact resolver caller summary for public API responses and logs. */
export type ResolverCallerSummary = {
  id: string | null;
  type: ResolverCallerType;
  workspaceId: string | null;
};

/** Options for `ResolverContextHelpers.invokerSummary`. */
export type ResolverInvokerSummaryOptions<NoneType extends string = "none"> = {
  /** Label to use when no invoker is present. Defaults to `"none"`. */
  noneType?: NoneType;
};

/** A compact resolver invoker summary for public API responses and logs. */
export type ResolverInvokerSummary<NoneType extends string = "none"> = {
  hasInvoker: boolean;
  invokerId: string | null;
  invokerType: AuthenticatedPrincipal["type"] | NoneType;
  workspaceId: string | null;
};

/** Typed environment helpers for resolver context values. */
export type ResolverEnvHelpers = {
  /**
   * Return an environment value as a string.
   *
   * `fallback` is used when the variable is absent.
   */
  string(name: string, fallback?: string): string;
};

/** Helper methods for normalizing resolver runtime context. */
export type ResolverContextHelpers = {
  /** Return a normalized summary of the authenticated caller. */
  callerSummary(): ResolverCallerSummary;
  /** Return a normalized summary of the invoker, if one was supplied. */
  invokerSummary<NoneType extends string = "none">(
    options?: ResolverInvokerSummaryOptions<NoneType>,
  ): ResolverInvokerSummary<NoneType>;
  /** Environment value conversion helpers. */
  env: ResolverEnvHelpers;
};

/** Runtime resolver context values accepted by `resolverContext`. */
export type ResolverContextInput = {
  user: TailorUser;
  invoker?: TailorInvoker;
  env: TailorEnv;
};

function presentPrincipalId(id: string): string | null {
  return id === unauthenticatedTailorUser.id ? null : id;
}

function presentWorkspaceId(workspaceId: string): string | null {
  return workspaceId === unauthenticatedTailorUser.workspaceId ? null : workspaceId;
}

function readEnv(env: TailorEnv, name: string): unknown {
  return (env as Record<string, unknown>)[name];
}

/**
 * Create helpers for normalizing resolver runtime context.
 *
 * The helper keeps common caller, invoker, and environment-value shaping close to
 * the resolver body while preserving the raw `user`, `invoker`, and `env`
 * context values for custom behavior.
 *
 * @param context - Resolver runtime context values.
 * @returns Helper methods for common context summaries.
 * @example
 * import { createResolver, resolverContext, t } from "@tailor-platform/sdk";
 *
 * export default createResolver({
 *   name: "contextSummary",
 *   operation: "query",
 *   output: t.object({
 *     caller: t.object({
 *       id: t.string({ optional: true }),
 *       type: t.enum(["anonymous", "user", "machine_user"]),
 *       workspaceId: t.string({ optional: true }),
 *     }),
 *     request: t.object({
 *       hasInvoker: t.bool(),
 *       invokerId: t.string({ optional: true }),
 *       invokerType: t.enum(["none", "user", "machine_user"]),
 *       workspaceId: t.string({ optional: true }),
 *     }),
 *     label: t.string(),
 *   }),
 *   body: ({ user, invoker, env }) => {
 *     const context = resolverContext({ user, invoker, env });
 *
 *     return {
 *       caller: context.callerSummary(),
 *       request: context.invokerSummary(),
 *       label: context.env.string("SUMMARY_LABEL", "unset"),
 *     };
 *   },
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function resolverContext({
  user,
  invoker,
  env,
}: ResolverContextInput): ResolverContextHelpers {
  return {
    callerSummary() {
      return {
        id: presentPrincipalId(user.id),
        type: user.type === "" ? "anonymous" : user.type,
        workspaceId: presentWorkspaceId(user.workspaceId),
      };
    },
    invokerSummary<NoneType extends string = "none">(
      options?: ResolverInvokerSummaryOptions<NoneType>,
    ): ResolverInvokerSummary<NoneType> {
      const noneType = (options?.noneType ?? "none") as NoneType;
      if (!invoker) {
        return {
          hasInvoker: false,
          invokerId: null,
          invokerType: noneType,
          workspaceId: null,
        };
      }

      return {
        hasInvoker: true,
        invokerId: presentPrincipalId(invoker.id),
        invokerType: invoker.type,
        workspaceId: presentWorkspaceId(invoker.workspaceId),
      };
    },
    env: {
      string(name, fallback = "") {
        const value = readEnv(env, name);
        return value == null ? fallback : String(value);
      },
    },
  };
}
