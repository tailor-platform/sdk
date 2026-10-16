---
"@tailor-platform/sdk": patch
---

Find tables in TailorDB namespaces with more than 50 tables in `tailor tailordb truncate <tables...>`, and in `tailor query --engine sql` for apps with more than one TailorDB namespace. Tables created after the first 50 in a namespace were reported as `The following tables were not found in any namespace` or `Could not find namespace for tables in query`. When listing a namespace's tables fails, both commands now stop with that error instead of skipping that namespace and continuing with the others.
