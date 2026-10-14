---
"@tailor-platform/sdk": minor
---

Add `tailor data clone` to copy the data of an application from one workspace to another, and `tailor data operation get` to check on a started clone or wait for it with `--wait`. It copies the TailorDB namespaces registered in the application's subgraph; `--copy-files` and `--copy-idp-users` also copy TailorDB file content and IdP users. `--name` defaults to the application name in the config file. `data clone` waits for the clone to finish (up to `--timeout`, 30 minutes by default); pass `--no-wait` to start it and exit.
