---
"@tailor-platform/sdk": patch
---

Fix plugin-generated resolvers being silently ignored. Resolver output from table and namespace hooks is now loaded, bundled, and deployed to the resolver namespace with the same name as the hook's TailorDB namespace. The two are separate namespaces that only share the name; the resolver namespace is created automatically when it is not configured, and its settings apply when it is. Resolvers that your existing plugins already return are deployed on the next `deploy`; without `defaultPermission` on their resolver namespace, anonymous callers can reach them.
