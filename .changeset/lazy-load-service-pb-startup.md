---
"@tailor-platform/sdk": patch
---

Improve CLI startup time for commands that do not connect to the platform. Commands such as `profile list`, `profile delete`, `login`, and `logout` now start approximately 5x faster (~1.6s instead of ~8s).
