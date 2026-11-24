---
"@tailor-platform/sdk": patch
---

Accept an explicit `undefined` for the optional properties of the IdP, Auth, and TailorDB service config types, and type the nested `fields` of an Auth user profile field as `Record<string, TailorDBFieldOutput>` instead of `any`.
