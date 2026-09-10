---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add two lint rules that flag, in files defining a resolver, executor, workflow job, or HTTP adapter, the Node-only globals (`no-node-only-globals`) and Node built-in module imports (`no-node-builtin-imports`) that the Tailor Platform runtime does not provide. Both print the same suggested alternative the build does, and both leave configuration, scripts, and tests alone. Enabled in newly scaffolded projects.
