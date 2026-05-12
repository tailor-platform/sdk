# SDK Improvement Proposals (Driven by LLM Challenge)

Living catalog of `packages/sdk/` improvement opportunities discovered by
`llm-challenge`. Entries are tagged with an Anthropic-style **affordance** —
the kind of SDK redesign that would prevent the failure — and link back to the
failing test groups that surfaced them.

The taxonomy comes from
[Anthropic — Writing effective tools for AI agents (2025-09)](https://www.anthropic.com/engineering/writing-tools-for-agents).
A failure category describes the surface ("type_error", "logic_error"); an
affordance describes the remedy ("consolidation_candidate", "naming_bias",
"context_bloat", ...). See `llm-challenge/runner/affordance.ts` for the
canonical list of affordances and their associated redesign suggestions.

## Workflow

1. Run `pnpm challenge:solve --all --context-profile <profile>` to refresh
   baseline numbers across profiles.
2. Each report's "Suggested API Redesigns" block lists patterns that fired in
   the last run. Move concrete proposals here.
3. When an improvement lands in `packages/sdk/`, re-run the relevant problem
   from the same context profile and record the score delta below the entry.
4. Use `--split holdout` once held-out problems exist to verify the change did
   not overfit train.

---

## Open Proposals

The four entries below are seeded from PR #1148's verification table (20 of
140 tests failing on `001-saas-subscription-platform` across every context
profile). They were initially recorded in the PR body; promoting them here
makes them addressable by affordance.

### 1. `createExecutor` description discoverability — `missing_action_verb`

**Failure signal**: `* executor has non-empty description` (4 tests).
Affects every executor problem. The reference solution leaves `description`
empty even though tests assert a non-empty value.

**Diagnosis**: `createExecutor`'s JSDoc does not communicate that
`description` is expected to be meaningful, and there is no `@example`
showing a populated description. The agent treats the field as
boilerplate-optional.

**Proposed SDK change**:

- Add a multi-trigger `@example` block on `createExecutor` that wires
  `recordTrigger({ events: ["created", "updated"] })` and includes a
  description sentence.
- Consider a TS `description: string` type instead of `description?: string`
  so the compiler nags. (Breaking — defer to next major.)

**Doc fallback**: Add JSDoc `@example` with a non-empty description and a
short "why descriptions matter for operability" sentence.

**Anthropic analog**: clearer action verbs and richer JSDoc made
`schedule_event` discoverable in their MCP audit.

---

### 2. Workflow composition guidance — `missing_action_verb`

**Failure signal**: `billingCycle workflow calculateCharges: *` (6 tests).
Workflow logic that composes pure calculation against platform side effects
(`createRecord`, `triggerJob`) is hard for agents to assemble correctly.

**Diagnosis**: `createWorkflow` / `createWorkflowJob` JSDoc lacks examples
covering multi-step charge calculation, and the boundary between pure logic
inside a job and the platform-mutating calls is implicit.

**Proposed SDK change**:

- Add JSDoc `@example` covering a 2–3 step calculation job.
- Document the pure-logic vs platform-operation split with a brief code
  comment template.
- Consider exposing a `defineJobLogic(fn): JobBody` helper so agents have a
  named verb for "this is the pure calculation".

**Doc fallback**: Section in CLAUDE.md showing how to wire a multi-step
workflow with charge calculation.

---

### 3. Resolver validation paths — `param_confusion`

**Failure signal**: `upgradeSubscription resolver *` validation paths
(8 tests). The agent fails to handle early-return / structured-error cases
like downgrade rejection, same-plan rejection, non-existent record handling.

**Diagnosis**: `createResolver`'s `body` parameter does not signal which
error-shape the platform expects, so agents invent ad-hoc shapes (throw,
return null, return `{ error: "..." }`).

**Proposed SDK change**:

- Document the structured-error contract on `createResolver` JSDoc.
- Add concrete `@example` blocks for the three common patterns: validate
  pre-call, throw with code, return typed result.
- Consider a `ResolverError` branded type so the compiler can guide.

**Doc fallback**: Worked example in docs covering each rejection style.

---

### 4. TailorDB `datetime` + create hook discoverability — `docs_only`

**Failure signal**: `Invoice model issuedAt is datetime with create hook`
(1 test). The agent picks the wrong field type or misses the create-hook
wiring on `issuedAt`.

**Diagnosis**: `db.datetime()` + create-hook combination is uncommon; JSDoc
does not show it.

**Proposed SDK change**: pure documentation — no API change required.

**Doc fallback**: Add an `@example` to `db.datetime` covering a create hook
that sets the current timestamp.

---

## Future Held-out Problems

The held-out split machinery (`split: "holdout"` in `meta.json`,
`--split holdout` filter, `analytics.overfitGap` warning) is in place but no
held-out problems exist yet. Candidates ranked by Anthropic-style affordance
coverage:

| Candidate problem           | Targets affordance               | Why it complements train                                                                                                           |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `003-trigger-consolidation` | `consolidation_candidate`        | Forces agents to pick `recordTrigger({events})` vs three sibling triggers; measures whether the consolidated form is discoverable. |
| `004-workflow-wait-points`  | `param_confusion`, `naming_bias` | `defineWaitPoints` has two access styles (namespaced vs destructured); measures whether agents pick the right one.                 |
| `005-resolver-vs-executor`  | `missing_namespace`              | Forces a choice between resolver / executor for a trigger-shaped task; surfaces SDK ambiguity.                                     |
| `006-plugin-discovery`      | `implicit_assumption`            | Requires `kyselyTypePlugin` in `tailor.config.ts` to make `getDB()` work; measures whether the precondition is discoverable.       |

`006-plugin-discovery` is also a candidate to exercise `apiCheck.requiredSymbols`
(currently structural-only; not yet seeded into any problem because the 001
reference solution still uses the deprecated `defineGenerators`).

---

## Closed Proposals

(none yet — open proposals land here once the SDK change ships and the
follow-up benchmark run records the score delta.)
