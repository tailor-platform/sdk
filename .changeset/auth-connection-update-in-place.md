---
"@tailor-platform/sdk": patch
---

Preserve OAuth sessions when updating auth connections by using in-place updates instead of delete-and-recreate. Only changed fields are sent via a diff-based update mask; `client_secret` is omitted from the mask when absent (CI scenario). Users are notified to authorize newly created connections, and warned to re-authorize if an update revokes the session.
