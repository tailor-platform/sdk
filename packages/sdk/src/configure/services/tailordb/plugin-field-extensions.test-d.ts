import { db, type TailorDBField } from "@tailor-platform/sdk";
// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expectTypeOf, test } from "vitest";
import type { output } from "#/types/helpers";

// Augmenting through the public package specifier (rather than the internal
// #/plugin/types module) verifies the documented plugin-author path in
// docs/plugin/custom.md actually reaches the interface schema.ts consumes.
declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "test/status": { values: readonly string[] };
    "test/status2": { values: readonly string[] };
    "test/soft-delete": Record<string, never>;
    "test/bad-shape": Record<string, never>;
  }
  interface PluginFieldExtensions<Fields extends string, Config> {
    "test/status": Config extends { values: infer V extends readonly string[] }
      ? { status: TailorDBField<{ type: "enum"; array: false }, V[number]> }
      : never;
    "test/status2": Config extends { values: infer V extends readonly string[] }
      ? { status: TailorDBField<{ type: "enum"; array: false }, V[number]> }
      : never;
    // Deliberately not a Record<string, TailorAnyDBField>, to test that
    // .plugin() rejects a malformed PluginFieldExtensions entry.
    "test/bad-shape": string;
  }
}

declare const cond: boolean;

describe(".plugin() field injection", () => {
  test("injects a field typed from the literal per-call config, without `as const`", () => {
    const table = db
      .table("Order", { name: db.string() })
      .plugin({ "test/status": { values: ["PENDING", "APPROVED"] } });

    expectTypeOf<output<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
      status: "PENDING" | "APPROVED";
    }>();
  });

  test("merges fields from multiple plugins attached in one call", () => {
    const table = db.table("Order", { name: db.string() }).plugin({
      "test/status": { values: ["PENDING", "APPROVED"] },
      "test/soft-delete": {},
    });

    expectTypeOf<output<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
      status: "PENDING" | "APPROVED";
    }>();
  });

  test("a plugin id with no PluginFieldExtensions entry leaves Fields unchanged", () => {
    const table = db.table("Order", { name: db.string() }).plugin({
      "test/soft-delete": {},
    });

    expectTypeOf<output<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  test("colliding with an existing field name is a type error", () => {
    const table = db.table("Order", { name: db.string(), status: db.string() });
    // @ts-expect-error status conflicts with an existing field
    table.plugin({ "test/status": { values: ["PENDING", "APPROVED"] } });
  });

  test("colliding field names between two attached plugins is a type error", () => {
    const table = db.table("Order", { name: db.string() });
    table.plugin({
      // @ts-expect-error status is also injected by test/status2
      "test/status": { values: ["PENDING"] },
      // @ts-expect-error status is also injected by test/status
      "test/status2": { values: ["A", "B"] },
    });
  });

  test("an unregistered plugin id is a type error", () => {
    const table = db.table("Order", { name: db.string() });
    // @ts-expect-error "unregistered/plugin" has no PluginConfigs entry
    table.plugin({ "unregistered/plugin": {} });
  });

  test("an empty config leaves Fields unchanged (UnionToIntersection<never> is unknown, not never)", () => {
    const table = db.table("Order", { name: db.string() }).plugin({});
    expectTypeOf<output<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  test("a malformed PluginFieldExtensions entry (not a field record) is a type error", () => {
    const table = db.table("Order", { name: db.string() });
    // @ts-expect-error "test/bad-shape"'s PluginFieldExtensions entry is `string`, not a field record
    table.plugin({ "test/bad-shape": {} });
  });

  test("an unknown property on a registered plugin's config is a type error", () => {
    const table = db.table("Order", { name: db.string() });
    table.plugin({
      "test/status": {
        values: ["PENDING", "APPROVED"],
        // @ts-expect-error typo is not part of PluginConfigs["test/status"]
        typo: true,
      },
    });
  });

  test("a config value that is itself a union (e.g. from a ternary) is a type error", () => {
    const table = db.table("Order", { name: db.string() });
    table.plugin({
      // @ts-expect-error a union config would otherwise silently collapse status to never
      "test/status": cond
        ? ({ values: ["PENDING", "APPROVED"] } as const)
        : ({ values: ["DRAFT", "PUBLISHED"] } as const),
    });
  });

  test("a union nested inside a single config property still distributes correctly", () => {
    const table = db.table("Order", { name: db.string() }).plugin({
      "test/status": { values: cond ? (["PENDING", "APPROVED"] as const) : (["DRAFT"] as const) },
    });

    expectTypeOf<output<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
      status: "PENDING" | "APPROVED" | "DRAFT";
    }>();
  });
});
