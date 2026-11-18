---
"@tailor-platform/sdk": patch
---

Show an OAuth2 client that `tailor deploy` replaces for a client type change under its Auth service in the plan, with that service as its `namespace` in `--dry-run --json`. Name resource types the same way across deploy messages: the duplicate-name and Auth IdP config conflict errors say "Auth service" and "IdP service" instead of "Auth namespace" and "IdP namespace", and pre-flight validation says "TailorDB namespace", "Resolver namespace", "Auth IdP config", and "Workflow job" instead of "TailorDB service", "Pipeline service", "Auth IDP config", and "Workflow job function".
