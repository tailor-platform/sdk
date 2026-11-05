---
"@tailor-platform/sdk": patch
---

The CLI now retries a Platform request, such as creating a workspace or applying a resource during `tailor deploy`, when the connection closes before a secure connection is established, instead of failing with `Client network socket disconnected before secure TLS connection was established`
