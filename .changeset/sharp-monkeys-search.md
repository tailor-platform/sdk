---
"@tailor-platform/sdk": patch
---

Show an OAuth2 client that `tailor deploy` replaces for a client type change under its Auth service in the plan, with that service as its `namespace` in `--dry-run --json`. Change how these deploy messages name resource types:

- The duplicate-name and Auth IdP config conflict errors say "Auth service" and "IdP service" instead of "Auth namespace" and "IdP namespace".
- Pre-flight validation says "TailorDB namespace", "Resolver namespace", "Auth IdP config", and "Workflow job" instead of "TailorDB service", "Pipeline service", "Auth IDP config", and "Workflow job function".
- The owner-conflict and unmanaged-resource lists of the plan and its confirmation prompts say "TailorDB namespace", "Resolver namespace", and "Function" instead of "TailorDB service", "Pipeline service", and "Function registry".
- The warning about a workflow job left undeleted because a workflow still references it says "Workflow job" instead of "workflow job function".
