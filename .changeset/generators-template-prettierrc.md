---
"@tailor-platform/create-sdk": patch
---

Remove the unused empty `.prettierrc` from the `generators` template, completing the same cleanup already applied to the other templates. The template formats with `oxfmt`, and `.oxfmtrc.json` keeps the generated `src/generated/` and `src/seed/` output out of formatting.
