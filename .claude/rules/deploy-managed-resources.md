---
paths:
  - "packages/sdk/src/cli/commands/deploy/apply-phases.ts"
  - "packages/sdk/src/cli/commands/deploy/apply-phases.test.ts"
  - "packages/sdk/src/cli/commands/deploy/managed-resource-type.ts"
  - "packages/sdk/src/cli/commands/deploy/test-helpers/plan-results.ts"
  - "packages/sdk/src/cli/commands/remove.ts"
  - "packages/sdk/src/cli/commands/remove.test.ts"
  - "packages/sdk/src/cli/commands/deploy/deploy.ts"
  - "packages/sdk/src/cli/commands/deploy/deploy.test.ts"
  - "packages/sdk/src/cli/commands/deploy/plan-report.ts"
  - "packages/sdk/src/cli/commands/deploy/validate-plan.ts"
  - "packages/sdk/src/cli/commands/deploy/validate-plan.test.ts"
  - "packages/sdk/src/cli/commands/deploy/managed-resources.ts"
  - "packages/sdk/src/cli/commands/deploy/managed-resources.test.ts"
  - "packages/sdk/src/cli/commands/deploy/resources-in-use.ts"
  - "packages/sdk/src/cli/commands/deploy/label-refresh.test.ts"
---

# Adding a Deploy-Managed Resource Type

`PlannedDeployment` (`cli/commands/deploy/apply-phases.ts`) names the plan kinds `deploy`
manages, and `ManagedResourceType` (`cli/commands/deploy/managed-resource-type.ts`) names the
resource types their change sets hold. A new change set or plan kind needs an entry in each
consumer below; the guard named with it fails while one is missing.

## Per resource type

- `managed-resource-type.ts` — add the id to `ManagedResourceType` and its label to
  `MANAGED_RESOURCE_LABELS`, which messages and prompts use (guard: `satisfies Record`).
  `deploy --dry-run --json` reports the id, so keep existing ids. Keep the module import-free:
  planners and `confirm.ts` cannot import `managed-resources.ts` without an import cycle.
- `managed-resources.ts`'s `MANAGED_RESOURCES` — map the type to its change set, and an item in a
  service namespace to that namespace and its owner type. Read the namespace from the items' own
  fields, so a renamed request field fails to compile. The cross-config delete filter reads this
  table, skipping the types in `NOT_CLAIMED_ACROSS_CONFIGS`. Guard: `managed-resources.test.ts`
  fails for a change set or `*Deletes` list that is not exactly one entry's.
- `managed-resources.ts`'s `GLOBAL_RESOURCE_NAMES` — add a type whose name is workspace-global
  (its TRN carries no namespace or application), so two configs cannot define one name.
- `managed-resources.ts`'s `collectImportantResourceDeletions` — add a type whose deletion needs
  confirmation, and list it under **Confirmation** in
  `packages/sdk/docs/cli/application.template.md`.
- `test-helpers/plan-results.ts`'s `emptyPlanResults` — add the new plan result. `deploy.test.ts`
  puts a create, an update, and a delete into each change set and a delete into each `*Deletes`
  list, and checks the plan report; `remove.test.ts` checks that `remove` lists each delete. Name a
  delete list outside a change set `*Deletes`, and add a list removal never plans to
  `DELETE_LISTS_REMOVAL_NEVER_PLANS` in `remove.test.ts`.
- `plan-report.ts` — add the change set to a grouped section of `buildPlanReport` or to
  `plainChangeSetsOf`.
- `remove.ts` — add the type to `REMOVAL_LISTING_ORDER`.
- `validate-plan.ts`'s `REQUEST_CHECKS` — check the request that each item of the type's
  `creates`, `updates`, and `replaces` sends against its proto schema, and give a list whose items
  send none an empty array (guard: `satisfies`, which requires each list the change set can hold).
  Check `unchanged` items only when deploy sends them again. `validate-plan.test.ts` plans an item
  whose workspace ID is not a UUID into each list with checks and expects a violation.
- `resources-in-use.ts`'s `CHECKED_RESOURCES` — add a type that other resources reference, so
  deleting it while referenced fails.
- `label-refresh.test.ts`'s `CASES` — when the type's planner reads its SDK labels, attach a
  refresh to its unchanged items (`labeledResourceChecks` or `labelRefreshOf`) and write it in its
  create-update apply with `writeLabelRefreshes`; add its case, or the reason it has none (guard:
  `satisfies Record`). The cases check only the apply, so also plan an owned unchanged resource
  with stale SDK labels in the planner's tests and expect its `labelRefresh`.

## Per plan kind

- `apply-phases.ts` — apply the plan in a create-update phase and a delete phase. Guard:
  `apply-phases.test.ts`'s `PLAN_MARKERS` (`satisfies Record<keyof PlanResults, string>`).
- `remove.ts` — add the plan to `plans` (`satisfies PlanResults`) and its `delete` apply calls.
  Guard: `remove.test.ts`'s `APPLY_BY_PLAN`.
- `deploy.ts`'s `REUSABLE_ON_REBUILD_KINDS` (and `ReusablePlanKind` in `apply-phases.ts`) — add
  the kind when its plan embeds neither `env` nor this run's bundle content, so the conditional
  rebuild reuses it instead of re-planning.
- `deploy.ts`'s `shouldForceApplyAll` — add a candidate TRN for each top-level service of the
  kind, so a change of SDK version re-applies its resources.
- The plan result carries `conflicts`, `unmanaged`, `takeovers`, and `resourceOwners`;
  `collectOwnerConflicts`, `collectUnmanagedResources`, `collectTakeovers`, and
  `collectResourceOwners` (`managed-resources.ts`) read every plan through `Object.values`. A
  plan that merges the results of several trackers carries each of these fields over.
