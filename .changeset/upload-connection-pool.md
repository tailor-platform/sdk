---
"@tailor-platform/sdk": patch
---

Spread `deploy`'s function/script/static website uploads across a small pool of HTTP/2 connections (default 4, tunable via `TAILOR_UPLOAD_CONNECTIONS`) instead of multiplexing them all on one. A single HTTP/2 connection has one fixed, non-enlargeable flow-control window that concurrent upload streams divide between them; local benchmarking showed this made both aggregate and per-upload throughput scale ~linearly with connection count (measured up to ~24x with 16 uploads spread across 16 connections), independent of round-trip latency. This also mitigates a fairness regression in Node.js 24+'s HTTP/2 client, where nghttp2 dropped its priority-tree stream scheduler (following RFC 9113's deprecation of HTTP/2 priority signaling): uploads sharing one connection can now finish 12x+ apart in wall-clock time even though aggregate throughput is unchanged, making individual uploads more likely to exceed the platform's per-upload timeout.
