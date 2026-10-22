---
"@tailor-platform/sdk": patch
---

Fix plugin-generated resolvers being silently ignored. Resolver output from table and namespace hooks is now loaded, bundled, and deployed in the hook's namespace, using matching resolver namespace settings. Resolvers that your existing plugins already return are deployed on the next `deploy`; without `defaultPermission` on their resolver namespace, anonymous callers can reach them.
