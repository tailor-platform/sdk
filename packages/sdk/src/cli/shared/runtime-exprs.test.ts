import { describe, test, expect } from "vitest";
import {
  buildExecutorArgsExpr,
  buildResolverOperationHookExpr,
  buildResolverPermissionGuardExpr,
} from "./runtime-exprs";

describe("buildExecutorArgsExpr", () => {
  const env = { API_URL: "https://example.com", DEBUG: true };

  describe("event triggers (with actor)", () => {
    const eventTriggerKinds = ["schedule", "tailordb", "idpUser", "authAccessToken"] as const;

    test.each(eventTriggerKinds)("%s includes appNamespace, actor transform, and env", (kind) => {
      const expr = buildExecutorArgsExpr(kind, env);
      expect(expr).toContain("...args");
      expect(expr).toContain("appNamespace: args.namespaceName");
      expect(expr).toContain("actor: args.actor");
      expect(expr).toContain("attributeMap");
      expect(expr).toContain("attributeList");
      expect(expr).toContain(`env: ${JSON.stringify(env)}`);
    });

    test.each(["tailordb", "idpUser", "authAccessToken"] as const)(
      "%s trigger injects kind and rawKind from args.eventType",
      (kind) => {
        const expr = buildExecutorArgsExpr(kind, env);
        expect(expr).toContain('event: args.eventType?.split(".").pop()');
        expect(expr).toContain("rawEvent: args.eventType");
      },
    );

    test("schedule trigger does not inject event", () => {
      const expr = buildExecutorArgsExpr("schedule", env);
      expect(expr).not.toContain("event:");
    });
  });

  describe("resolverExecuted trigger", () => {
    test("includes success/result/error transformations, actor, appNamespace, and env", () => {
      const expr = buildExecutorArgsExpr("resolverExecuted", env);
      expect(expr).toContain("success: !!args.succeeded");
      expect(expr).toContain("result: args.succeeded?.result.resolver");
      expect(expr).toContain("error: args.failed?.error");
      expect(expr).toContain("actor: args.actor");
      expect(expr).toContain("appNamespace: args.namespaceName");
      expect(expr).toContain(`env: ${JSON.stringify(env)}`);
    });
  });

  describe("incomingWebhook trigger", () => {
    test("includes rawBody mapping, appNamespace, and env, but not actor transform", () => {
      const expr = buildExecutorArgsExpr("incomingWebhook", env);
      expect(expr).toContain("rawBody: args.raw_body");
      expect(expr).not.toContain("actor:");
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

  test("includes user transformation via tailorUserMap", () => {
    const expr = buildResolverOperationHookExpr(env);
    expect(expr).toContain("user:");
    expect(expr).toContain("user.workspace_id");
    expect(expr).toContain("user.attribute_map");
    expect(expr).toContain("user.attributes");
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
});

describe("buildResolverPermissionGuardExpr", () => {
  class TailorErrorMessage extends Error {}

  function runGuard(
    permission: Parameters<typeof buildResolverPermissionGuardExpr>[0],
    user: unknown,
  ): void {
    const guard = buildResolverPermissionGuardExpr(permission);
    if (!guard) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("context", "TailorErrorMessage", guard);
    fn({ user }, TailorErrorMessage);
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
    expect(() => runGuard(permission, { type: "" })).toThrow(TailorErrorMessage);
  });

  test("permit:false denies matching callers instead of allowing them", () => {
    const permission = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: false },
    ] as const;
    expect(() => runGuard(permission, { type: "user" })).toThrow(TailorErrorMessage);
    expect(() => runGuard(permission, { type: "" })).not.toThrow();
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
    expect(() => runGuard(permission, { type: "", attributes: { role: "ADMIN" } })).toThrow(
      TailorErrorMessage,
    );
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
    expect(() => runGuard(permission, { type: "" })).toThrow(/must be logged in/);
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
    expect(() => runGuard(permission, { type: "" })).toThrow("access denied: must be logged in");

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
