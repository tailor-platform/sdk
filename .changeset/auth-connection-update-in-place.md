---
"@tailor-platform/sdk": patch
---

Preserve OAuth sessions when updating auth connections by using in-place updates instead of delete-and-recreate. Only changed configuration fields are sent to the server. When no client secret is provided (such as in CI environments), the update preserves the existing secret. Users are notified to authorize newly created connections, and warned to re-authorize if an update revokes the session.
