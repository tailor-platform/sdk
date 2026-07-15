import { describe, test, expect } from "vitest";
import { buildExecutorArgsExpr, buildResolverOperationHookExpr } from "./runtime-exprs";

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
