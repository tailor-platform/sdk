---
"@tailor-platform/sdk": patch
---

Share the tsconfig `paths` alias lookup cache across every resolver, executor, workflow job, auth hook, and HTTP adapter bundled in one command, instead of each bundle reading and parsing its ancestor tsconfigs from scratch. A project with many resolvers or executors bundles noticeably faster as a result.
