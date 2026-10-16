---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy --dry-run --json` reporting `resourceType` in `warnings` and `conflicts` as the display name from the human-readable plan, such as `Executor` or `TailorDB service`. It now reports a stable identifier such as `executor` or `tailordb.service`, and the human-readable plan is unchanged. The values change as follows:

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
