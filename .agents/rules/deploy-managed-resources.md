# Adding a Deploy-Managed Resource Type

`PlannedDeployment` (`cli/commands/deploy/apply-phases.ts`) is the source of
truth for which resource types `deploy` manages. Adding a key there does not
automatically wire the resource into every consumer — check each of these:

- `cli/commands/deploy/test-helpers/plan-results.ts`'s `emptyPlanResults` — add the new
  plan result. `remove.test.ts` and `deploy.test.ts` put one delete into each of its delete
  lists and fail for a list that `remove` or the deploy plan report leaves out. They find a
  list as a change set's `deletes` or as an array named `*Deletes`, so name a delete list
  outside a change set that way; add a list removal never plans to
  `DELETE_LISTS_REMOVAL_NEVER_PLANS` in `remove.test.ts`.
- `cli/commands/remove.ts` — its `plans` object is `satisfies PlanResults`, so a missing key
  fails to compile, but the `delete` apply calls and the `deletions` list it prints and
  decides from still need a manual update.
- `cli/commands/deploy/plan-report.ts` — `buildPlanReport` and `summarizePlanResults` list
  each change set by hand.
- `cli/commands/deploy/validate-plan.ts` — `ValidatePlanInput` is a `PlanResults` alias,
  but `validatePlan` still needs `creates`/`updates` calls added for the new resource's
  proto schema.
- `cli/commands/deploy/managed-resources.ts`'s `managedResourceGroups` — add the new change
  set, so `deploy` drops a delete that another config in the same run still claims. Add a
  resource with a workspace-global name through `DEPLOY_MANAGED_RESOURCE_DEFINITIONS`
  instead, which also rejects that name in two configs.
- `cli/commands/deploy/managed-resource-type.ts`'s `ManagedResourceType` — add the new
  resource's id before using it as a `resourceType`. `deploy --dry-run --json` reports these
  ids, so never rename an existing one. Keep the module import-free: planners and
  `confirm.ts` cannot import `managed-resources.ts` without an import cycle.
- `collectOwnerConflicts` / `collectUnmanagedResources` / `collectResourceOwners`
  (`managed-resources.ts`) derive from `PlanResults` via `Object.values`, so no change
  is needed there as long as the new plan result carries `conflicts`/`unmanaged`/
  `resourceOwners`.
