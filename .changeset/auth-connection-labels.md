---
"@tailor-platform/sdk": patch
---

fix(cli): track auth connection ownership via platform labels

`deploy` now tags auth connections with SDK ownership labels and uses them to decide which connections to manage, matching every other auth resource. Connections that are not labeled by the SDK are treated as unowned: they are surfaced in the unmanaged-resource confirmation prompt rather than silently deleted, and once you confirm adoption the SDK label is written even when the connection is otherwise unchanged, so later deploys recognize it as owned. Auth connection deletions are also shown in the deletion confirmation prompt.
