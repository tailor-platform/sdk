---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer fails when it cannot restore the secret vault of an IdP client whose name the platform rejects when reading the client, such as a name shorter than three characters. It prints a warning for that client and continues.
