---
"@tailor-platform/sdk": minor
---

With TypeScript 7.1 or later, add the SDK as a content mapper for `.tailor` files in tsconfig.json and TypeScript reads `Env`, `Attributes`, `MachineUserName`, `IdpName`, and the other names your `tailor.config.ts` defines directly from the config, so you no longer need `tailor.d.ts` or `tailor generate` to keep them current.
