---
"@tailor-platform/sdk": major
---

Settle how `publishEvents` resolves across TailorDB types, resolvers, IdPs, and workflows.

- An unset `publishEvents` is now recomputed on every `deploy` from the executors declared by the **same config**, in both directions: adding a subscribing trigger turns publishing on, and removing the last one turns it back off. Previously a workflow or job kept publishing forever once it had been enabled, with nothing in the config showing that state.
- Auto-detection no longer looks at executors in other configs, so the resolved value no longer depends on which configs `--config` selects. Sharing a resource with an executor in another config now needs `publishEvents: true` declared on the resource itself.
- Subscribing an executor to a resource another config declares now requires that config in the same `deploy`. `deploy` fails with an explanation instead of creating an executor whose events never arrive — including for workflow subscriptions, which were not checked at all before.
