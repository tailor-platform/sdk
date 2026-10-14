---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Update `@politty/zod` to 0.4.3. A positional argument is no longer accepted under its own name as an option, so pass the value positionally: `tailor profile create dev`, not `tailor profile create --name dev`. Most commands report such an option as unknown; a few, such as `tailor completion` and `npm create @tailor-platform/sdk`, only warn and ignore it. `tailor secret vault create --name`, `tailor secret vault delete --name`, and `tailor tailordb truncate --tables`, which the documentation and earlier release notes use, still accept both forms. Mixing the two forms, as in `tailor tailordb truncate --tables User Order`, is rejected; repeat the option for each table, as in `--tables User --tables Order`.
