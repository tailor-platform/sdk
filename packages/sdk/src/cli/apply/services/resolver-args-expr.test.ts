import { describe, test, expect } from "vitest";
import { buildResolverOperationHookExpr } from "./resolver-args-expr";

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
