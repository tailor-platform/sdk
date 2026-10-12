---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Update `@politty/zod` to 0.4.3. A positional argument is no longer accepted under its own name as an option: `tailor profile create --name dev` is now reported as an unknown option, so pass the value positionally as `tailor profile create dev`. `tailor secret vault create --name`, `tailor secret vault delete --name`, and `tailor tailordb truncate --tables`, which the documentation uses, still accept both forms. Mixing the two forms, as in `tailor tailordb truncate --tables User Order`, is rejected; repeat the option for each table, as in `--tables User --tables Order`.
