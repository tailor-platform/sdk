---
"@tailor-platform/sdk": minor
---

Bound the number of concurrent unary platform RPCs during `apply`/`deploy` to
make fresh-workspace deploys more reliable (streaming requests such as function
uploads are not gated). Previously every resource was created at
once, which could overload the platform and surface a flaky
`already_exists` error on file-bearing TailorDB types (e.g.
`... ShipmentDocument_file: duplicated key not allowed`). Concurrency now
defaults to 16 and can be tuned with the `TAILOR_APPLY_CONCURRENCY` environment
variable. When that error does surface, it is now routed to crash/error
reporting (previously skipped for this error class) so the otherwise-silent
race is captured for diagnosis.
