---
"@tailor-platform/sdk": patch
---

Report `tailor login` failures that occur while preparing the authorization URL through normal CLI error output, instead of crashing with an unhandled promise rejection and leaving the local callback server running.
