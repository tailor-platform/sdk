---
"@tailor-platform/sdk": patch
---

Allow specifying the path where types are generated

By default, types are generated inside `node_modules/@tailor-platform/sdk` based on env and attribute settings, but you can now change the path with `TAILOR_PLATFORM_SDK_TYPE_PATH`.
This is primarily an option for developers, preventing type definitions from being overridden when working with multiple SDK projects simultaneously.
