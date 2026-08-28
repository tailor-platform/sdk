---
"@tailor-platform/sdk": patch
---

Revert the `@toiroakr/lines-db` dependency to `0.12.2`. `0.12.3` and `0.12.4` raised its required Node.js version to `>=24.19.0`, which is incompatible with `@tailor-platform/sdk`'s own supported minimum of Node.js `22.18.0` and broke installing the SDK on Node 22 with some package managers.
