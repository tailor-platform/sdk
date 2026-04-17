---
"@tailor-platform/sdk": patch
---

Accept a wider range of boolean values for environment variables

The following environment variables now accept common truthy/falsy spellings
(case-insensitive): `true/false`, `1/0`, `yes/no`, `on/off`, `t/f`, `y/n`.

- `TAILOR_ENABLE_INLINE_SOURCEMAP`
- `TAILOR_PLATFORM_SDK_BUILD_ONLY`
- `DEBUG`

Previously only the literal string `"true"` enabled these flags.
