---
"@tailor-platform/sdk": patch
---

Find types in TailorDB namespaces with more than 50 types in `tailor-sdk tailordb truncate <types...>`, and in `tailor-sdk query --engine sql` for apps with more than one TailorDB namespace. Types created after the first 50 in a namespace were reported as `The following types were not found in any namespace` or `Could not find namespace for types in query`. When listing a namespace's types fails, both commands now stop with that error instead of skipping that namespace and continuing with the others.
