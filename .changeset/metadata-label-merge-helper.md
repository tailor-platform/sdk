---
"@tailor-platform/sdk": patch
---

Stop `deploy` and the migration commands from deleting metadata labels they do not manage.

Writing labels replaces the whole label map on the platform, so every write the SDK made from labels it had read earlier deleted anything written in between — by another CLI invocation, the console, or a tool such as Terraform. Labels are now read again immediately before each write and the intended change is applied to what is found, so unrelated labels survive.

A write that would leave the labels exactly as they are is skipped, so deploying an unchanged project no longer rewrites the label map of every resource it manages.

Releasing ownership of a managed vault (`secret create` / `update` / `delete` on a vault declared in `defineSecretManager()`) now also drops the application id label, and keeps any label added since the check ran. Previously the id was left behind, so the vault stayed owned by the config: removing it from `defineSecretManager()` and deploying deleted the vault together with every secret in it, which is exactly what releasing ownership is supposed to prevent.
