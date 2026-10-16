---
"@tailor-platform/sdk": patch
---

`tailor deploy --dry-run --json` now reports `resourceType` in `warnings` and `conflicts` as a stable identifier instead of the display name shown in the human-readable plan, which is unchanged. Update any automation that matches on the old values:

| Before                      | After                                    |
| --------------------------- | ---------------------------------------- |
| `Application`               | `application`                            |
| `AIGateway`                 | `aigateway`                              |
| `Auth connection`           | `auth.connection`                        |
| `Auth service`              | `auth.service`                           |
| `Executor`                  | `executor`                               |
| `Function registry`         | `function_registry`                      |
| `IdP service`               | `idp.service`                            |
| `Pipeline service`          | `pipeline.service`                       |
| `Secret Manager vault`      | `secret.vault`                           |
| `StaticWebsite`             | `staticwebsite`                          |
| `TailorDB service`          | `tailordb.service`                       |
| `Workflow`                  | `workflow`                               |
| `Workflow execution policy` | `workflow_job_function_execution_policy` |
| `secret` (skipped secrets)  | `secret.secret`                          |
