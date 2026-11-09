---
"@tailor-platform/sdk": patch
---

`tailor generate`, `tailor deploy`, and other commands that load TailorDB types, resolvers, executors, workflows, and HTTP adapters now print a loading failure once instead of two or three times. When several files fail to load at once, the files other than the reported one are listed by name without their errors. A reported error whose message does not name its file now starts with the file's path.
