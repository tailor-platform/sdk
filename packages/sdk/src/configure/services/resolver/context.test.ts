import { describe, expect, expectTypeOf, test } from "vitest";
import { unauthenticatedTailorUser } from "@/types/user";
import { resolverContext } from "./context";
import type { ResolverCallerSummary, ResolverInvokerSummary } from "./context";
import type { TailorInvoker, TailorUser } from "@/types/user";

const authenticatedUser: TailorUser = {
  id: "user-1",
  type: "user",
  workspaceId: "workspace-1",
  attributes: { role: "admin" },
  attributeList: [],
};

const machineInvoker: NonNullable<TailorInvoker> = {
  id: "machine-1",
  type: "machine_user",
  workspaceId: "workspace-1",
  attributes: { service: "orders" },
  attributeList: [],
};

describe("resolverContext", () => {
  test("summarizes an anonymous caller and missing invoker", () => {
    const context = resolverContext({
      user: unauthenticatedTailorUser,
      invoker: null,
      env: {},
    });

    expect(context.callerSummary()).toEqual({
      id: null,
      type: "anonymous",
      workspaceId: null,
    });
    expect(context.invokerSummary()).toEqual({
      hasInvoker: false,
      invokerId: null,
      invokerType: "none",
      workspaceId: null,
    });
  });

  test("summarizes authenticated caller and invoker values", () => {
    const context = resolverContext({
      user: authenticatedUser,
      invoker: machineInvoker,
      env: {},
    });

    expect(context.callerSummary()).toEqual({
      id: "user-1",
      type: "user",
      workspaceId: "workspace-1",
    });
    expect(context.invokerSummary()).toEqual({
      hasInvoker: true,
      invokerId: "machine-1",
      invokerType: "machine_user",
      workspaceId: "workspace-1",
    });
  });

  test("uses a custom missing-invoker label", () => {
    const context = resolverContext({
      user: authenticatedUser,
      env: {},
    });

    const summary = context.invokerSummary({ noneType: "anonymous" });

    expectTypeOf(summary).toEqualTypeOf<ResolverInvokerSummary<"anonymous">>();
    expect(summary.invokerType).toBe("anonymous");
  });

  test("converts environment values to strings with fallbacks", () => {
    const context = resolverContext({
      user: authenticatedUser,
      env: {
        SUMMARY_LABEL: "active",
        COUNT: 3,
        ENABLED: true,
      },
    });

    expect(context.env.string("SUMMARY_LABEL", "unset")).toBe("active");
    expect(context.env.string("COUNT", "0")).toBe("3");
    expect(context.env.string("ENABLED", "false")).toBe("true");
    expect(context.env.string("MISSING", "unset")).toBe("unset");
  });

  test("exposes stable summary types", () => {
    const context = resolverContext({
      user: authenticatedUser,
      invoker: null,
      env: {},
    });

    expectTypeOf(context.callerSummary()).toEqualTypeOf<ResolverCallerSummary>();
    expectTypeOf(context.invokerSummary()).toEqualTypeOf<ResolverInvokerSummary>();
  });
});
