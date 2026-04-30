---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Drop the `multiline-ts` dependency in favour of an in-tree implementation. The upstream package ships a `preinstall: npx only-allow pnpm` hook that, when a fresh copy is resolved (e.g. `npx create-tailor-sdk@latest`), causes npm's exec lock to time out with `ECOMPROMISED`. Replacing the dependency removes that failure path. Also drops `multiline-ts` from the `pnpm-workspace.yaml` `allowBuilds` list emitted by `create-tailor-sdk`.
