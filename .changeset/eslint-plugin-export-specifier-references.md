---
"@tailor-platform/eslint-plugin-sdk": patch
---

Fix `no-unconditional-permit` reporting an imported unsafe constant twice when it is re-exported with `export { name }`, and `no-node-only-globals` flagging export names such as `export { proc as process }` and re-exports from other modules such as `export { process } from "./pipeline"` and `export * as process from "./pipeline"`.
