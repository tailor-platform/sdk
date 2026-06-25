---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk-codemod": patch
---

Standardize SDK-owned environment variables on the `TAILOR_*` namespace.

Replace the removed SDK-specific environment variables with their new names: `TAILOR_CONFIG_PATH`, `TAILOR_DTS_PATH`, `TAILOR_CI_ALLOW_ID_INJECTION`, `TAILOR_DEPLOY_BUILD_ONLY`, `TAILOR_BUILD_OUTPUT_DIR`, `TAILOR_SKILLS_SOURCE`, `TAILOR_TEMPLATE_SDK_VERSION`, `TAILOR_PLATFORM_URL`, `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, `TAILOR_INLINE_SOURCEMAP`, `TAILOR_QUERY_NEWLINE_ON_ENTER`, and `TAILOR_APP_LOG_LEVEL`. The deprecated `TAILOR_TOKEN` fallback is removed; use `TAILOR_PLATFORM_TOKEN`. The v2 codemod rewrites the removed environment variable names to their replacements.
