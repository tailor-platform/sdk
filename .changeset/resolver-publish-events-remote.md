---
"@tailor-platform/sdk": patch
---

Stop `deploy` from disabling resolver execution events when the subscribing executor is not part of the run. A resolver that left `publishEvents` unset had it resolved to `false` whenever no executor in the current deploy targeted it, silently turning off event delivery that a previous deploy had enabled. The deployed value is now kept in that case, matching how TailorDB types already behave. Setting `publishEvents: false` explicitly still disables publishing.
