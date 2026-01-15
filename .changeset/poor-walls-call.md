---
"@tailor-platform/sdk": patch
---

fix: add colored output to logger icons and messages

- Apply colors (cyan, green, yellow, red, gray) based on log type
- Gate logger.debug() output with DEBUG=true environment variable
