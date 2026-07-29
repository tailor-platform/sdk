---
"@tailor-platform/sdk": major
---

Settle how `publishEvents` resolves across TailorDB types, resolvers, IdPs, and workflows.

- An unset `publishEvents` is now recomputed on every `deploy` from the executors taking part in the run, in both directions: adding a subscribing trigger turns publishing on, and removing the last one turns it back off. Previously a workflow or job kept publishing forever once it had been enabled, with nothing in the config showing that state.
- An executor in another config enables publishing the same way, as long as both configs take part in the same `deploy`. `deploy` records that dependency on the application, so deploying the owning config alone later asks for confirmation instead of silently turning publishing off — and fails outright in a non-interactive environment.
- Subscribing to a resource no config in the run declares now fails with an explanation instead of creating an executor whose events never arrive. This includes workflow subscriptions, which were not checked at all before.
