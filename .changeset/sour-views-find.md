---
"@tailor-platform/sdk": patch
---

`tailor deploy` and `tailor remove` now also stop with `SERVICE_IN_USE` before they change anything when they would delete an application that an executor's `graphql` operation targets, or a Secret Manager secret or vault that a `webhook` operation's `headers`, an Auth service's OIDC `idProvider` `clientSecret`, or its SCIM `bearerSecret` names. An executor without `appName` targets its own application, so a `deploy` that drops a config's last service while that config keeps a `graphql` executor stops too, until the config adds a service back or drops that executor. Before, they deleted it without reporting that it was still in use, which left the executor or Auth service using an application or secret that no longer exists. In the error's `context.uses`, these entries carry `resourceType` `application` or `secret.secret` (with the vault as `namespace`), and `usedBy` can now be an Auth IdP config (`auth.idp_config`) or SCIM config (`auth.scim`).
