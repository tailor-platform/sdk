import type { ChallengeStage } from "../shared/helpers";
import type { FailureCategory } from "./score";

/**
 * Failure affordance taxonomy adapted from Anthropic's "Writing effective tools
 * for AI agents" (https://www.anthropic.com/engineering/writing-tools-for-agents).
 *
 * A `FailureCategory` describes the surface (what error message appeared); a
 * `FailureAffordance` describes the **kind of SDK redesign that would prevent
 * the failure**. The two are orthogonal — a single category can map to several
 * affordances depending on what the solver actually tried.
 */
export type FailureAffordance =
  | "consolidation_candidate"
  | "naming_bias"
  | "context_bloat"
  | "missing_namespace"
  | "param_confusion"
  | "missing_action_verb"
  | "type_too_loose"
  | "type_too_strict"
  | "redundant_call_pattern"
  | "implicit_assumption"
  | "error_message_opaque"
  | "docs_only";

export interface RedesignSuggestion {
  affordance: FailureAffordance;
  apiChange: string;
  docFallback: string;
  anthropicAnalog: string;
}

const redesignTable: Record<FailureAffordance, Omit<RedesignSuggestion, "affordance">> = {
  consolidation_candidate: {
    apiChange:
      "Merge sibling APIs into a single API with an events / variants parameter (e.g. recordCreatedTrigger + Updated + Deleted -> recordTrigger({ events }))",
    docFallback: "Add @example showing the consolidated form and link siblings via @see",
    anthropicAnalog: "list_users + list_events + create_event -> schedule_event",
  },
  naming_bias: {
    apiChange:
      "Rename so the verb matches the agent's expectation (list -> search when filtered; fetch -> get for single records)",
    docFallback: "Document the actual return shape in JSDoc to defeat the implicit bias",
    anthropicAnalog: "list_contacts -> search_contacts",
  },
  context_bloat: {
    apiChange:
      "Add a response_format / fields enum so callers can opt into CONCISE vs DETAILED output and drop technical IDs by default",
    docFallback: "Document default response shape and pagination contract",
    anthropicAnalog: "Slack tool: 206 -> 72 tokens (1/3) via response_format enum",
  },
  missing_namespace: {
    apiChange:
      "Disambiguate sibling APIs with a unifying prefix or service-level namespace, or fold them under a parent object",
    docFallback: "Add cross-references between similar APIs in JSDoc and CLAUDE.md",
    anthropicAnalog: "asana_projects_search vs jira_search (prefix-based namespacing)",
  },
  param_confusion: {
    apiChange:
      "Rename ambiguous params with precision suffixes (e.g. user -> user_id, name -> displayName) or replace primitives with branded types",
    docFallback: "Add @example showing every accepted shape per parameter",
    anthropicAnalog: "user -> user_id improves selection precision",
  },
  missing_action_verb: {
    apiChange:
      "Add a workflow-shaped action API that mirrors how a human describes the task, instead of forcing agents to chain primitives",
    docFallback: "Add an end-to-end @example chaining the primitives",
    anthropicAnalog: "schedule_event consolidates list/availability/create",
  },
  type_too_loose: {
    apiChange:
      "Tighten the type (discriminated union, branded primitive, exhaustive enum) so the agent cannot pass an invented shape",
    docFallback: "Document the expected shape with @example and a runtime guard",
    anthropicAnalog: "Generic any/unknown invites hallucinated params",
  },
  type_too_strict: {
    apiChange:
      "Relax the type where agents have valid but rejected inputs (e.g. exactOptional with explicit undefined; require Date but allow ISO string)",
    docFallback: "Document the precise constraint and offer a conditional-spread helper",
    anthropicAnalog: "Tools that reject valid forms cause repeated retries",
  },
  redundant_call_pattern: {
    apiChange:
      "Provide idempotency keys / memoization, or fold repeated calls into a single batched API",
    docFallback: "Document idempotency contract and recommended caching",
    anthropicAnalog: "Lots of redundant tool calls suggests pagination or token-limit rightsizing",
  },
  implicit_assumption: {
    apiChange:
      "Promote the precondition into a type-level requirement (brand the type so getDB() refuses to compile without kyselyTypePlugin), or fail fast with a fix-suggesting error",
    docFallback:
      "Add a precondition note at the top of JSDoc and an example with the plugin wired up",
    anthropicAnalog: "Tools should not require setup that the agent must guess",
  },
  error_message_opaque: {
    apiChange:
      "Rewrite error messages to name the next concrete action (which field, which import, which docs anchor)",
    docFallback: "Map error codes to fix recipes in CLAUDE.md",
    anthropicAnalog: "Opaque 'Invalid parameter' becomes 'Pass thread_ts from previous response'",
  },
  docs_only: {
    apiChange: "(no API change needed — pure documentation gap)",
    docFallback: "Add a JSDoc @example or CLAUDE.md note for this pattern",
    anthropicAnalog: "—",
  },
};

export function getRedesignSuggestion(affordance: FailureAffordance): RedesignSuggestion {
  return { affordance, ...redesignTable[affordance] };
}

export interface AffordanceContext {
  stage: ChallengeStage;
  output: string;
  category: FailureCategory | undefined;
  /**
   * Failing test names in the tests stage. Used to bias logic_error toward more
   * specific affordances when the test text mentions a known SDK concept.
   */
  failedTestNames?: string[];
}

const triggerSiblings =
  /recordCreatedTrigger|recordUpdatedTrigger|recordDeletedTrigger|idpUserCreatedTrigger|idpUserUpdatedTrigger|idpUserDeletedTrigger|authAccessTokenIssuedTrigger|authAccessTokenRefreshedTrigger|authAccessTokenRevokedTrigger/;

const pluginAssumption = /kyselyTypePlugin|kysely_type|definePlugins|getDB\(\)/i;

const awaitOmission = /Promise<.+>|expected.*await|missing.*await/i;

/**
 * Best-effort classifier mapping a failure to the **kind of SDK redesign** that
 * would most likely prevent it. The classifier is heuristic by design: it
 * encodes the patterns visible in the current 001/002 problem set and is
 * intended to be extended as new problems land. When no heuristic fires, the
 * function returns `undefined`, which is rendered as "(unclassified)" downstream.
 */
export function classifyAffordance(ctx: AffordanceContext): FailureAffordance | undefined {
  const { stage, output, category, failedTestNames = [] } = ctx;

  // Infra / runner failures are not SDK signals; bail out before reaching any
  // text heuristics. `undefined` category also reaches here when callers
  // forget to set it; we tolerate it but cannot infer an affordance without
  // knowing what surface failed, so return undefined.
  if (category === undefined || category === "infra_failure" || category === "runner_error") {
    return undefined;
  }

  // Plugin / setup preconditions that the agent had to guess. Checked before
  // every stage-specific branch because the kyselyTypePlugin signal shows up
  // across multiple stages (typecheck, tests, generate) with different
  // categories.
  if (pluginAssumption.test(output)) {
    return "implicit_assumption";
  }

  if (stage === "apiCheck") {
    // Forbidden patterns / forbidden imports → siblings exist with better names.
    if (/Forbidden|forbidden|legacy|deprecated/.test(output)) {
      return "naming_bias";
    }
    // Missing required imports / required patterns → namespacing problem.
    return "missing_namespace";
  }

  if (category === "import_error") {
    if (/createResolver|createExecutor|createWorkflow|createWorkflowJob/.test(output)) {
      return "missing_namespace";
    }
    if (/defineResolver|defineWorkflow|defineExecutor/.test(output)) {
      // Agent reached for a sibling that doesn't exist (the SDK only exposes
      // `create*` factories, not `define*` ones).
      return "naming_bias";
    }
    // Generic import miss — most likely the agent invented an SDK name.
    return "naming_bias";
  }

  if (category === "type_error") {
    // Check too-loose first so an implicit-any error is not pre-empted by the
    // broader default. All other type errors map to `type_too_strict` because
    // the SDK historically rejects more inputs than it accepts (e.g. exactOptional,
    // excess properties). Revisit when new type-error subcategories diverge.
    if (/implicitly has |implicit any|Type 'any'|Type 'unknown'/i.test(output)) {
      return "type_too_loose";
    }
    return "type_too_strict";
  }

  if (category === "api_misuse" || category === "generate_error") {
    return "error_message_opaque";
  }

  if (category === "missing_file") {
    return "missing_action_verb";
  }

  if (category === "logic_error") {
    const haystack = [output, ...failedTestNames].join("\n");
    if (triggerSiblings.test(haystack)) {
      return "consolidation_candidate";
    }
    if (/non-empty description|empty description|description.*required/i.test(haystack)) {
      return "missing_action_verb";
    }
    if (awaitOmission.test(haystack)) {
      return "param_confusion";
    }
    if (/workflow|createWorkflow|defineWaitPoints/i.test(haystack)) {
      return "missing_action_verb";
    }
    if (/resolver|createResolver/i.test(haystack)) {
      return "param_confusion";
    }
    return "docs_only";
  }

  // api_design surface is handled in the apiCheck branch above; fall through is
  // defensive in case a new stage routes a similar output here.
  if (category === "api_design") {
    return "naming_bias";
  }

  return undefined;
}
