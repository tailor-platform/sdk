---
"@tailor-platform/sdk": patch
---

fix: use POSIX path separators in seed generator for Windows compatibility

The seed generator now uses forward slashes for import paths on all platforms, ensuring consistent output between Windows and Unix systems.
