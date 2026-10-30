---
"@tailor-platform/sdk-plugin-setup": patch
---

The workflows `tailor setup ci` generates for several app directories pass the config paths as `TAILOR_CONFIG_PATH` instead of the deprecated `TAILOR_PLATFORM_SDK_CONFIG_PATH`. Run `tailor setup update` to regenerate existing workflows, after updating `@tailor-platform/sdk` to the version released with this change: older versions of `tailor deploy` ignore `TAILOR_CONFIG_PATH`.
