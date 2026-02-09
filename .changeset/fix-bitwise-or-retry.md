---
"@tailor-platform/sdk": patch
---

fix(cli): use separate case statements for retry error codes

The `isRetirable` function was using bitwise OR in a switch case, which only matches the bitwise OR result rather than either code individually. This fix ensures retries work correctly for both `ResourceExhausted` and `Unavailable` error codes.
