---
"@tailor-platform/sdk": patch
---

Follow the Platform API, whose list responses for machine users and OAuth2 clients no longer carry a client secret. `tailor deploy`, `tailor show`, `tailor machineuser list` and `tailor oauth2client list` behave as before.
