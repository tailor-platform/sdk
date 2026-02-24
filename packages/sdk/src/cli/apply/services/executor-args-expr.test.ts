import { describe, test, expect } from "vitest";
import { buildExecutorArgsExpr } from "./executor-args-expr";

describe("buildExecutorArgsExpr", () => {
  const env = { API_URL: "https://example.com", DEBUG: true };

  describe("event triggers (with actor)", () => {
    const eventTriggerKinds = [
      "schedule",
      "recordCreated",
      "recordUpdated",
      "recordDeleted",
      "idpUserCreated",
      "idpUserUpdated",
      "idpUserDeleted",
      "authAccessTokenIssued",
      "authAccessTokenRefreshed",
      "authAccessTokenRevoked",
    ] as const;

    for (const kind of eventTriggerKinds) {
      test(`${kind} includes appNamespace, actor transform, and env`, () => {
        const expr = buildExecutorArgsExpr(kind, env);
        expect(expr).toContain("...args");
        expect(expr).toContain("appNamespace: args.namespaceName");
        expect(expr).toContain("actor: args.actor");
        expect(expr).toContain("attributeMap");
        expect(expr).toContain("attributeList");
        expect(expr).toContain(`env: ${JSON.stringify(env)}`);
      });
    }

    test("all event triggers produce identical expressions", () => {
      const exprs = eventTriggerKinds.map((kind) => buildExecutorArgsExpr(kind, env));
      const unique = new Set(exprs);
      expect(unique.size).toBe(1);
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
      expect(expr).toContain("actor: args.actor");
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
