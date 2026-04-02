---
"@tailor-platform/sdk": minor
---

Add `emailConfig` option to `defineIdp()` for namespace-level email defaults.

- `fromName`: default sender display name for emails
- `passwordResetSubject`: default subject for password reset emails
- Validation: max 200 characters, no newline characters (header injection prevention)
