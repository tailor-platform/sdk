import { describe, test, expect } from "vitest";
import {
  INVOKER_EXPR,
  buildExecutorArgsExpr,
  buildResolverOperationHookExpr,
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
            userId: "11111111-1111-4111-8111-111111111111",
            workspaceId: "workspace-1",
            attributeMap: { role: "admin" },
            attributes: ["role"],
          },
        }).actor,
      ).toEqual({
        id: "11111111-1111-4111-8111-111111111111",
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
        { userType: "USER_TYPE_UNSPECIFIED", userId: "11111111-1111-4111-8111-111111111111" },
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
      { type: "USER_TYPE_UNSPECIFIED", id: "11111111-1111-4111-8111-111111111111" },
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
        id: "11111111-1111-4111-8111-111111111111",
        type: "user",
        workspaceId: "workspace-1",
        attributeMap: { role: "member" },
        attributes: ["role"],
      }),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
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
