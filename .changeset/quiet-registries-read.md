---
"@tailor-platform/sdk": minor
---

With TypeScript 7.1 or later, add the SDK as a content mapper for `.tailor` files in tsconfig.json and TypeScript reads `Env`, `Attributes`, `MachineUserName`, `IdpName`, and the other names your `tailor.config.ts` defines directly from the config, so you no longer need `tailor.d.ts`. When the `tsconfig.json` that applies to `tailor.config.ts` enables the mapper, `tailor generate` and `tailor deploy` stop writing `tailor.d.ts` and warn if an old copy remains.
