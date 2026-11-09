---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

`tailor seed`, `tailor setup`, and `tailor tailordb erd` print an error that points at a file, such as an invalid `tailor.config.ts`, with the file's path first, as `tailor` does. This also applies to the failures `tailor setup update` lists and to a failed rebuild in `tailor tailordb erd serve`.
