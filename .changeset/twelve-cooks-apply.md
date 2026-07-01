---
"@tailor-platform/sdk": minor
---

Allow `tailor-sdk deploy --config` to accept comma-separated config paths so interdependent apps can be deployed together. Application, executor, workflow job, StaticWebsite, TailorDB, Auth, IdP, Resolver, AIGateway, and Secret Manager vault names must be unique across all configs passed to a single deploy, and resources still owned by another config in the same deploy are no longer deleted.
