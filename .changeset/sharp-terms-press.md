---
"@tailor-platform/sdk": patch
---

Report three config and definition mistakes with their own error codes instead of `UNEXPECTED_ERROR`, so `--json` output carries the facts in `context`:

- An invalid resolver `defaultPermission` is `CONFIG_INVALID`. The error is located at the config file and lists each issue with its path, such as `resolver.main.defaultPermission.0.conditions.0.0`.
- `tailor function run` on a resolver file that more than one resolver namespace's `files` match is `RESOLVER_NAMESPACE_AMBIGUOUS`, located at the config file, with the namespaces in `context` and the remedy in `suggestion`.
- Resolvers in one namespace, executors, workflow jobs, or HTTP adapters that share a name are `DEFINITION_NAME_DUPLICATE`. The error lists every definition of every duplicated name rather than the first pair, carries the remedy in `suggestion`, and prints workflow job and HTTP adapter files relative to the current directory.
