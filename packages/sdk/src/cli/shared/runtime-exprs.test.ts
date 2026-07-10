import { describe, test, expect } from "vitest";
import {
  buildExecutorArgsExpr,
  buildResolverAuthGuardExpr,
  buildResolverOperationHookExpr,
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

describe("buildResolverAuthGuardExpr", () => {
  class TailorErrorMessage extends Error {}

  function runGuard(auth: Parameters<typeof buildResolverAuthGuardExpr>[0], user: unknown): void {
    const guard = buildResolverAuthGuardExpr(auth);
    if (!guard) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("context", "TailorErrorMessage", guard);
    fn({ user }, TailorErrorMessage);
  }

  test("returns undefined when auth is omitted", () => {
    expect(buildResolverAuthGuardExpr(undefined)).toBeUndefined();
  });

  test("returns undefined when auth is public", () => {
    expect(buildResolverAuthGuardExpr("public")).toBeUndefined();
  });

  test("_loggedIn permit:true allows an authenticated user", () => {
    const auth = [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }] as const;
    expect(() => runGuard(auth, { type: "user" })).not.toThrow();
  });

  test("_loggedIn permit:true rejects an anonymous user", () => {
    const auth = [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }] as const;
    expect(() => runGuard(auth, { type: "" })).toThrow(TailorErrorMessage);
  });

  test("permit:false denies matching callers instead of allowing them", () => {
    const auth = [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: false }] as const;
    expect(() => runGuard(auth, { type: "user" })).toThrow(TailorErrorMessage);
    expect(() => runGuard(auth, { type: "" })).not.toThrow();
  });

  test("supports the != operator", () => {
    const auth = [{ conditions: [[{ user: "role" }, "!=", "BANNED"]], permit: true }] as const;
    expect(() => runGuard(auth, { attributes: { role: "MEMBER" } })).not.toThrow();
    expect(() => runGuard(auth, { attributes: { role: "BANNED" } })).toThrow(TailorErrorMessage);
  });

  test("supports the id operand", () => {
    const auth = [
      {
        conditions: [[{ user: "id" }, "=", "11111111-1111-1111-1111-111111111111"]],
        permit: true,
      },
    ] as const;
    expect(() => runGuard(auth, { id: "11111111-1111-1111-1111-111111111111" })).not.toThrow();
    expect(() => runGuard(auth, { id: "other" })).toThrow(TailorErrorMessage);
  });

  test("supports arbitrary user attribute operands", () => {
    const auth = [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }] as const;
    expect(() => runGuard(auth, { attributes: { role: "ADMIN" } })).not.toThrow();
    expect(() => runGuard(auth, { attributes: { role: "MEMBER" } })).toThrow(TailorErrorMessage);
  });

  test("ANDs multiple conditions within a policy", () => {
    const auth = [
      {
        conditions: [
          [{ user: "_loggedIn" }, "=", true],
          [{ user: "role" }, "=", "ADMIN"],
        ],
        permit: true,
      },
    ] as const;
    expect(() => runGuard(auth, { type: "user", attributes: { role: "ADMIN" } })).not.toThrow();
    expect(() => runGuard(auth, { type: "user", attributes: { role: "MEMBER" } })).toThrow(
      TailorErrorMessage,
    );
    expect(() => runGuard(auth, { type: "", attributes: { role: "ADMIN" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("ORs multiple allow policies", () => {
    // Allow machine-user callers unconditionally, or regular users with role ADMIN
    const auth = [
      { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
      { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
    ] as const;
    expect(() =>
      runGuard(auth, { attributes: { isServiceAccount: true, role: "MEMBER" } }),
    ).not.toThrow();
    expect(() =>
      runGuard(auth, { attributes: { isServiceAccount: false, role: "ADMIN" } }),
    ).not.toThrow();
    expect(() =>
      runGuard(auth, { attributes: { isServiceAccount: false, role: "MEMBER" } }),
    ).toThrow(TailorErrorMessage);
  });

  test("a deny policy overrides a matching allow policy", () => {
    const auth = [
      { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
    ] as const;
    expect(() => runGuard(auth, { type: "user", attributes: { role: "MEMBER" } })).not.toThrow();
    expect(() => runGuard(auth, { type: "user", attributes: { role: "BANNED" } })).toThrow(
      TailorErrorMessage,
    );
  });

  test("denies by default when no allow policy matches", () => {
    const auth = [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }] as const;
    expect(() => runGuard(auth, { attributes: { role: "GUEST" } })).toThrow(TailorErrorMessage);
  });

  test("includes description in the thrown message when present", () => {
    const auth = [
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
        description: "must be logged in",
      },
    ] as const;
    expect(() => runGuard(auth, { type: "" })).toThrow(/must be logged in/);
  });

  test("throws at bundle time on an empty auth array (schema should reject this, but guard defensively too)", () => {
    expect(() => buildResolverAuthGuardExpr([])).toThrow(/at least one policy/);
  });

  test("throws at bundle time on a policy with an empty conditions array (schema should reject this, but guard defensively too)", () => {
    const auth = [{ conditions: [], permit: true }] as const;
    expect(() => buildResolverAuthGuardExpr(auth)).toThrow(/at least one condition/);
  });
});
