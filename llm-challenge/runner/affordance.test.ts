import { describe, expect, it } from "vitest";
import { classifyAffordance, getRedesignSuggestion } from "./affordance";
import type { FailureAffordance } from "./affordance";

describe("classifyAffordance", () => {
  it("returns undefined for infra and runner errors regardless of stage output", () => {
    expect(
      classifyAffordance({
        stage: "tests",
        output: "any output",
        category: "infra_failure",
      }),
    ).toBeUndefined();
    expect(
      classifyAffordance({
        stage: "generate",
        output: "any output",
        category: "runner_error",
      }),
    ).toBeUndefined();
  });

  it("flags kyselyTypePlugin / setup preconditions as implicit_assumption", () => {
    expect(
      classifyAffordance({
        stage: "typecheck",
        output: "getDB() requires kyselyTypePlugin to be registered",
        category: "type_error",
      }),
    ).toBe<FailureAffordance>("implicit_assumption");
    expect(
      classifyAffordance({
        stage: "generate",
        output: "definePlugins must include the kysely type plugin",
        category: "generate_error",
      }),
    ).toBe<FailureAffordance>("implicit_assumption");
  });

  it("treats apiCheck failures with forbidden patterns as naming_bias", () => {
    expect(
      classifyAffordance({
        stage: "apiCheck",
        output: "Forbidden pattern matched: legacy-hyphenated-generator-package",
        category: "api_design",
      }),
    ).toBe<FailureAffordance>("naming_bias");
  });

  it("treats apiCheck failures with missing required imports as missing_namespace", () => {
    expect(
      classifyAffordance({
        stage: "apiCheck",
        output: "Missing required @tailor-platform/sdk import: createResolver",
        category: "api_design",
      }),
    ).toBe<FailureAffordance>("missing_namespace");
  });

  it("flags type_error with exactOptional / excess property as type_too_strict", () => {
    expect(
      classifyAffordance({
        stage: "typecheck",
        output: "Object literal may only specify known properties, and 'extra' does not exist",
        category: "type_error",
      }),
    ).toBe<FailureAffordance>("type_too_strict");
    expect(
      classifyAffordance({
        stage: "typecheck",
        output: "Type 'string | undefined' is not assignable to parameter of type 'string'",
        category: "type_error",
      }),
    ).toBe<FailureAffordance>("type_too_strict");
  });

  it("flags type_error with implicit any as type_too_loose", () => {
    expect(
      classifyAffordance({
        stage: "typecheck",
        output: "Parameter 'args' implicitly has an 'any' type",
        category: "type_error",
      }),
    ).toBe<FailureAffordance>("type_too_loose");
  });

  it("classifies import_error to missing_namespace when create* sdk symbols appear", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "Cannot find module: createWorkflowJob",
        category: "import_error",
      }),
    ).toBe<FailureAffordance>("missing_namespace");
  });

  it("classifies import_error to naming_bias when agent reached for non-existent define*", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "does not provide an export named 'defineResolver'",
        category: "import_error",
      }),
    ).toBe<FailureAffordance>("naming_bias");
  });

  it("classifies api_misuse as error_message_opaque (SDK validation errors)", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "validation: invalid schema for tailordb type",
        category: "api_misuse",
      }),
    ).toBe<FailureAffordance>("error_message_opaque");
  });

  it("classifies generate_error as error_message_opaque", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "Unknown error during code generation",
        category: "generate_error",
      }),
    ).toBe<FailureAffordance>("error_message_opaque");
  });

  it("falls through import_error to naming_bias for unknown sdk exports", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "does not provide an export named 'inventedHelper'",
        category: "import_error",
      }),
    ).toBe<FailureAffordance>("naming_bias");
  });

  it("classifies missing_file as missing_action_verb", () => {
    expect(
      classifyAffordance({
        stage: "generate",
        output: "required files missing: workflows/billingCycle.ts",
        category: "missing_file",
      }),
    ).toBe<FailureAffordance>("missing_action_verb");
  });

  it("classifies logic_error mentioning record*Trigger sibling APIs as consolidation_candidate", () => {
    expect(
      classifyAffordance({
        stage: "tests",
        output: "expected recordCreatedTrigger event handler to fire once",
        category: "logic_error",
      }),
    ).toBe<FailureAffordance>("consolidation_candidate");
  });

  it("uses failedTestNames as an additional haystack for the logic_error branch", () => {
    expect(
      classifyAffordance({
        stage: "tests",
        output: "Test failed",
        category: "logic_error",
        failedTestNames: ["invoiceCreated executor has non-empty description"],
      }),
    ).toBe<FailureAffordance>("missing_action_verb");
  });

  it("classifies await-omission patterns as param_confusion", () => {
    expect(
      classifyAffordance({
        stage: "tests",
        output: "expected await on trigger() result",
        category: "logic_error",
      }),
    ).toBe<FailureAffordance>("param_confusion");
  });

  it("falls back to docs_only for unclassified logic errors", () => {
    expect(
      classifyAffordance({
        stage: "tests",
        output: "Unrelated test assertion failed",
        category: "logic_error",
      }),
    ).toBe<FailureAffordance>("docs_only");
  });
});

describe("getRedesignSuggestion", () => {
  it("returns an apiChange and docFallback for every affordance", () => {
    const affordances: FailureAffordance[] = [
      "consolidation_candidate",
      "naming_bias",
      "context_bloat",
      "missing_namespace",
      "param_confusion",
      "missing_action_verb",
      "type_too_loose",
      "type_too_strict",
      "redundant_call_pattern",
      "implicit_assumption",
      "error_message_opaque",
      "docs_only",
    ];
    for (const affordance of affordances) {
      const suggestion = getRedesignSuggestion(affordance);
      expect(suggestion.affordance).toBe(affordance);
      expect(suggestion.apiChange.length).toBeGreaterThan(0);
      expect(suggestion.docFallback.length).toBeGreaterThan(0);
    }
  });

  it("docs_only conveys that no API change is needed", () => {
    const suggestion = getRedesignSuggestion("docs_only");
    expect(suggestion.apiChange).toMatch(/no API change/i);
  });

  it("consolidation_candidate quotes the Anthropic analog", () => {
    const suggestion = getRedesignSuggestion("consolidation_candidate");
    expect(suggestion.anthropicAnalog).toMatch(/schedule_event/);
  });

  it("naming_bias surfaces a rename suggestion mentioning list -> search", () => {
    const suggestion = getRedesignSuggestion("naming_bias");
    expect(suggestion.apiChange.toLowerCase()).toContain("rename");
    expect(suggestion.anthropicAnalog).toMatch(/list_contacts.*search_contacts/);
  });

  it("context_bloat suggests a response_format / fields enum", () => {
    const suggestion = getRedesignSuggestion("context_bloat");
    expect(suggestion.apiChange).toMatch(/response_format|fields enum/);
    expect(suggestion.anthropicAnalog).toMatch(/72 tokens|response_format/);
  });

  it("implicit_assumption recommends compile-time enforcement of preconditions", () => {
    const suggestion = getRedesignSuggestion("implicit_assumption");
    expect(suggestion.apiChange.toLowerCase()).toMatch(/precondition|compile-time|brand/);
  });
});
