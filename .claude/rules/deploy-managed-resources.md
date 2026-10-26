---
paths:
  - "packages/sdk/src/cli/commands/deploy/apply-phases.ts"
  - "packages/sdk/src/cli/commands/deploy/managed-resource-type.ts"
---

# Adding a Deploy-Managed Resource Type

`PlannedDeployment` (`cli/commands/deploy/apply-phases.ts`) is the source of
truth for which resource types `deploy` manages. Adding a key there does not
automatically wire the resource into every consumer — check each of these:

- `cli/commands/remove.ts` — its `plans` object is `satisfies Omit<PlannedDeployment, "application">`,
  so a missing key fails to compile, but the `create-update`/`delete` apply calls
  and the dry-run `removeLines`/`deletes.length === 0` checks still need a manual update.
- `cli/commands/deploy/validate-plan.ts` — `ValidatePlanInput` is a `PlannedDeployment`
  alias, but `validatePlan` still needs `creates`/`updates` calls added for the
  new resource's proto schema.
- `cli/commands/deploy/managed-resources.ts`'s `DEPLOY_MANAGED_RESOURCE_DEFINITIONS` —
  drives dry-run display and owner-conflict detection; add an entry per resource label.
- `cli/commands/deploy/managed-resource-type.ts`'s `ManagedResourceType` — add the new
  resource's id before using it as a `resourceType`. `deploy --dry-run --json` reports these
  ids, so never rename an existing one. Keep the module import-free: planners and
  `confirm.ts` cannot import `managed-resources.ts` without an import cycle.
- `collectOwnerConflicts` / `collectUnmanagedResources` / `collectResourceOwners`
  (`managed-resources.ts`) derive from `PlanResults` via `Object.values`, so no change
  is needed there as long as the new plan result carries `conflicts`/`unmanaged`/
  `resourceOwners`.
