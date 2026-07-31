import { describe, test, expect } from "vitest";
import {
  INVOKER_EXPR,
  buildExecutorArgsExpr,
  buildResolverOperationHookExpr,
  buildResolverPermissionGuardExpr,
} from "./runtime-exprs";

const runInvokerExpr = (invoker: unknown): unknown =>
  Function(
    "tailor",
    `return ${INVOKER_EXPR};`,
  )({
    context: { getInvoker: () => invoker },
  });

const runExecutorArgsExpr = (args: Record<string, unknown>): Record<string, unknown> =>
  Function("args", `return ${buildExecutorArgsExpr("schedule", {})};`)(args) as Record<
    string,
    unknown
  >;

const runResolverOperationHookExpr = (
  user: unknown,
  context = { pipeline: {}, args: {} },
): Record<string, unknown> =>
  Function(
    "context",
    "user",
    `return ${buildResolverOperationHookExpr({})}`,
  )(context, user) as Record<string, unknown>;

describe("buildExecutorArgsExpr", () => {
  const env = { API_URL: "https://example.com", DEBUG: true };

  describe("event triggers (with actor)", () => {
    const eventTriggerKinds = ["schedule", "tailordb", "idpUser", "authAccessToken"] as const;

    for (const kind of eventTriggerKinds) {
      test(`${kind} includes appNamespace, actor transform, and env`, () => {
        const expr = buildExecutorArgsExpr(kind, env);
        expect(expr).toContain("...args");
        expect(expr).toContain("appNamespace: args.namespaceName");
        expect(expr).toContain("actor: (($raw)");
        expect(expr).toContain("})(args.actor)");
        expect(expr).toContain("userType");
        expect(expr).toContain("attributeMap");
        expect(expr).toContain("attributeList");
        expect(expr).toContain(`env: ${JSON.stringify(env)}`);
      });
    }

    test("event triggers inject kind and rawKind from args.eventType", () => {
      const eventKinds = ["tailordb", "idpUser", "authAccessToken"] as const;
      for (const kind of eventKinds) {
        const expr = buildExecutorArgsExpr(kind, env);
        expect(expr).toContain('event: args.eventType?.split(".").pop()');
        expect(expr).toContain("rawEvent: args.eventType");
      }
    });

    test("schedule trigger does not inject event", () => {
      const expr = buildExecutorArgsExpr("schedule", env);
      expect(expr).not.toContain("event:");
    });

    test("maps actor payloads to TailorPrincipal shape", () => {
      expect(
        runExecutorArgsExpr({
          namespaceName: "app",
          actor: {
            userType: "USER_TYPE_USER",
            userId: "user-1",
            workspaceId: "workspace-1",
            attributeMap: { role: "admin" },
            attributes: ["role"],
          },
        }).actor,
      ).toEqual({
        id: "user-1",
        type: "user",
        workspaceId: "workspace-1",
        attributes: { role: "admin" },
        attributeList: ["role"],
      });
    });

    test("maps absent actor payloads to null", () => {
      const nilUuid = "00000000-0000-0000-0000-000000000000";
      const actors = [
        null,
        undefined,
        { userType: "USER_TYPE_UNSPECIFIED", userId: "user-1" },
        { userType: "USER_TYPE_USER", userId: nilUuid },
        { userType: "USER_TYPE_USER" },
      ];
      for (const actor of actors) {
        expect(runExecutorArgsExpr({ namespaceName: "app", actor }).actor).toBeNull();
      }
    });
  });

  describe("resolverExecuted trigger", () => {
    test("includes success/result/error transformations", () => {
      const expr = buildExecutorArgsExpr("resolverExecuted", env);
      expect(expr).toContain("success: !!args.succeeded");
      expect(expr).toContain("result: args.succeeded?.result.resolver");
      expect(expr).toContain("error: args.failed?.error");
    });

    test("includes actor transform and appNamespace", () => {
      const expr = buildExecutorArgsExpr("resolverExecuted", env);
      expect(expr).toContain("actor: (($raw)");
      expect(expr).toContain("})(args.actor)");
      expect(expr).toContain("appNamespace: args.namespaceName");
    });

    test("includes env", () => {
      const expr = buildExecutorArgsExpr("resolverExecuted", env);
      expect(expr).toContain(`env: ${JSON.stringify(env)}`);
    });
  });

  describe("incomingWebhook trigger", () => {
    test("includes rawBody mapping", () => {
      const expr = buildExecutorArgsExpr("incomingWebhook", env);
      expect(expr).toContain("rawBody: args.raw_body");
    });

    test("does NOT include actor transform", () => {
      const expr = buildExecutorArgsExpr("incomingWebhook", env);
      expect(expr).not.toContain("actor:");
    });

    test("includes appNamespace and env", () => {
      const expr = buildExecutorArgsExpr("incomingWebhook", env);
      expect(expr).toContain("appNamespace: args.namespaceName");
      expect(expr).toContain(`env: ${JSON.stringify(env)}`);
    });
  });

  describe("expression format", () => {
    test("wraps result in parenthesized object literal", () => {
      const expr = buildExecutorArgsExpr("schedule", {});
      expect(expr).toMatch(/^\(\{.*\}\)$/s);
    });

    test("empty env produces empty object", () => {
      const expr = buildExecutorArgsExpr("schedule", {});
      expect(expr).toContain("env: {}");
    });
  });
});

describe("buildResolverOperationHookExpr", () => {
  const env = { API_URL: "https://example.com", DEBUG: true };

  test("includes context.pipeline spread", () => {
    const expr = buildResolverOperationHookExpr(env);
    expect(expr).toContain("...context.pipeline");
  });

  test("maps context.args to input", () => {
    const expr = buildResolverOperationHookExpr(env);
    expect(expr).toContain("input: context.args");
  });

  test("includes caller transformation via tailorPrincipalMap", () => {
    const expr = buildResolverOperationHookExpr(env);
    expect(expr).toContain("caller:");
    expect(expr).toContain("workspace_id");
    expect(expr).toContain("attribute_map");
    expect(expr).toContain("attributes");
  });

  test("includes env injection", () => {
    const expr = buildResolverOperationHookExpr(env);
    expect(expr).toContain(`env: ${JSON.stringify(env)}`);
  });

  test("wraps result in parenthesized object literal with semicolon", () => {
    const expr = buildResolverOperationHookExpr({});
    expect(expr).toMatch(/^\(\{.*\}\);$/s);
  });

  test("empty env produces empty object", () => {
    const expr = buildResolverOperationHookExpr({});
    expect(expr).toContain("env: {}");
  });

  test("maps caller payloads to TailorPrincipal shape", () => {
    expect(
      runResolverOperationHookExpr({
        type: "USER_TYPE_MACHINE_USER",
        id: "machine-1",
        workspace_id: "workspace-1",
        attribute_map: { team: "ops" },
        attributes: ["team"],
      }).caller,
    ).toEqual({
      id: "machine-1",
      type: "machine_user",
      workspaceId: "workspace-1",
      attributes: { team: "ops" },
      attributeList: ["team"],
    });
  });

  test("maps absent caller payloads to null", () => {
    const nilUuid = "00000000-0000-0000-0000-000000000000";
    const users = [
      null,
      undefined,
      { type: "USER_TYPE_UNSPECIFIED", id: "user-1" },
      { type: "USER_TYPE_USER", id: nilUuid },
    ];
    for (const user of users) {
      expect(runResolverOperationHookExpr(user).caller).toBeNull();
    }
  });
});

describe("INVOKER_EXPR", () => {
  test("maps invoker payloads to TailorPrincipal shape", () => {
    expect(
      runInvokerExpr({
        id: "user-1",
        type: "user",
        workspaceId: "workspace-1",
        attributeMap: { role: "member" },
        attributes: ["role"],
      }),
    ).toEqual({
      id: "user-1",
      type: "user",
      workspaceId: "workspace-1",
      attributes: { role: "member" },
      attributeList: ["role"],
    });
  });

  test("maps anonymous invokers to null", () => {
    expect(runInvokerExpr(null)).toBeNull();
  });
});

describe("buildResolverPermissionGuardExpr", () => {
  class TailorErrorMessage extends Error {}

  function runGuard(
    permission: Parameters<typeof buildResolverPermissionGuardExpr>[0],
    caller: unknown,
  ): void {
    const guard = buildResolverPermissionGuardExpr(permission);
    if (!guard) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("context", "TailorErrorMessage", guard);
    fn({ caller }, TailorErrorMessage);
  }

  test("returns undefined when permission is omitted", () => {
    expect(buildResolverPermissionGuardExpr(undefined)).toBeUndefined();
  });

  test("returns undefined when permission is allowAnonymous", () => {
    expect(buildResolverPermissionGuardExpr("allowAnonymous")).toBeUndefined();
  });

  test("_loggedIn permit:true allows an authenticated user", () => {
    const permission = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
    ] as const;
    expect(() => runGuard(permission, { type: "user" })).not.toThrow();
  });

  test("_loggedIn permit:true rejects an anonymous user", () => {
    const permission = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
    ] as const;
    expect(() => runGuard(permission, null)).toThrow(TailorErrorMessage);
  });

  test("permit:false denies matching callers instead of allowing them", () => {
    const permission = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: false },
    ] as const;
    expect(() => runGuard(permission, { type: "user" })).toThrow(TailorErrorMessage);
    expect(() => runGuard(permission, null)).not.toThrow();
  });

  test("supports the != operator", () => {
    const permission = [
      { conditions: [[{ user: "role" }, "!=", "BANNED"]], permit: true },
    ] as const;
    expect(() => runGuard(permission, { attributes: { role: "MEMBER" } })).not.toThrow();
    expect(() => runGuard(permission, { attributes: { role: "BANNED" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("!= does not let a caller with no such attribute at all through", () => {
    // A missing attribute must not satisfy `!=` -- otherwise an
    // attribute-less caller would unintentionally match a policy meant to
    // exclude only a specific value.
    const permission = [
      { conditions: [[{ user: "role" }, "!=", "BANNED"]], permit: true },
    ] as const;
    expect(() => runGuard(permission, { attributes: null })).toThrow(TailorErrorMessage);
    expect(() => runGuard(permission, { attributes: {} })).toThrow(TailorErrorMessage);
  });

  test("supports the id operand", () => {
    const permission = [
      {
        conditions: [[{ user: "id" }, "=", "11111111-1111-1111-1111-111111111111"]],
        permit: true,
      },
    ] as const;
    expect(() =>
      runGuard(permission, { id: "11111111-1111-1111-1111-111111111111" }),
    ).not.toThrow();
    expect(() => runGuard(permission, { id: "other" })).toThrow(TailorErrorMessage);
  });

  test("supports arbitrary user attribute operands", () => {
    const permission = [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }] as const;
    expect(() => runGuard(permission, { attributes: { role: "ADMIN" } })).not.toThrow();
    expect(() => runGuard(permission, { attributes: { role: "MEMBER" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("ANDs multiple conditions within a policy", () => {
    const permission = [
      {
        conditions: [
          [{ user: "_loggedIn" }, "=", true],
          [{ user: "role" }, "=", "ADMIN"],
        ],
        permit: true,
      },
    ] as const;
    expect(() =>
      runGuard(permission, { type: "user", attributes: { role: "ADMIN" } }),
    ).not.toThrow();
    expect(() => runGuard(permission, { type: "user", attributes: { role: "MEMBER" } })).toThrow(
      TailorErrorMessage,
    );
    expect(() => runGuard(permission, null)).toThrow(TailorErrorMessage);
  });

  test("ORs multiple allow policies", () => {
    // Allow machine-user callers unconditionally, or regular users with role ADMIN
    const permission = [
      { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
      { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
    ] as const;
    expect(() =>
      runGuard(permission, { attributes: { isServiceAccount: true, role: "MEMBER" } }),
    ).not.toThrow();
    expect(() =>
      runGuard(permission, { attributes: { isServiceAccount: false, role: "ADMIN" } }),
    ).not.toThrow();
    expect(() =>
      runGuard(permission, { attributes: { isServiceAccount: false, role: "MEMBER" } }),
    ).toThrow(TailorErrorMessage);
  });

  test("a deny policy overrides a matching allow policy", () => {
    const permission = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
    ] as const;
    expect(() =>
      runGuard(permission, { type: "user", attributes: { role: "MEMBER" } }),
    ).not.toThrow();
    expect(() => runGuard(permission, { type: "user", attributes: { role: "BANNED" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("denies by default when no allow policy matches", () => {
    const permission = [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }] as const;
    expect(() => runGuard(permission, { attributes: { role: "GUEST" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("includes description in the thrown message when present", () => {
    const permission = [
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
        description: "must be logged in",
      },
    ] as const;
    expect(() => runGuard(permission, null)).toThrow(/must be logged in/);
  });

  test("only includes the description of the policy that actually caused the denial", () => {
    const permission = [
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
        description: "must be logged in",
      },
      {
        conditions: [[{ user: "role" }, "=", "BANNED"]],
        permit: false,
        description: "banned users are rejected",
      },
    ] as const;

    // Denied for failing the allow-list (not logged in) — only that policy's
    // description should appear, not the unrelated deny policy's.
    expect(() => runGuard(permission, null)).toThrow("access denied: must be logged in");

    // Denied for matching the deny policy (logged in but banned) — only that
    // policy's description should appear, not the unrelated allow policy's.
    expect(() => runGuard(permission, { type: "user", attributes: { role: "BANNED" } })).toThrow(
      "access denied: banned users are rejected",
    );

    // Allowed: logged in and not banned.
    expect(() =>
      runGuard(permission, { type: "user", attributes: { role: "MEMBER" } }),
    ).not.toThrow();
  });

  test("throws at bundle time on an empty permission array (schema should reject this, but guard defensively too)", () => {
    expect(() => buildResolverPermissionGuardExpr([])).toThrow(/at least one policy/);
  });

  test("throws at bundle time on a policy with an empty conditions array (schema should reject this, but guard defensively too)", () => {
    const permission = [{ conditions: [], permit: true }] as const;
    expect(() => buildResolverPermissionGuardExpr(permission)).toThrow(/at least one condition/);
  });
});
