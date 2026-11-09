---
"@tailor-platform/sdk": patch
---

`tailor generate` and `tailor deploy` now warn about a resolver mutation whose input looks like the acting user's ID, such as `approverId`, `actorId`, `executorId`, or `approvedBy`, since a caller can send another user's ID to act as them. Take the acting user from `caller` in `body`, compare the input with the caller in `permission`, or rename an input that names another user on purpose.
