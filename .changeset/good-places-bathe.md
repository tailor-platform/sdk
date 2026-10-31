---
"@tailor-platform/sdk-plugin-setup": patch
---

The workflows `tailor setup ci` generates for several app directories pass the config paths as `TAILOR_CONFIG_PATH` instead of the deprecated `TAILOR_PLATFORM_SDK_CONFIG_PATH`. The ERD preview job now sets `TAILOR_DTS_PATH` instead of the removed `TAILOR_PLATFORM_SDK_DTS_PATH`, so the type definitions it generates go to the job's scratch directory instead of next to each `tailor.config.ts`. Run `tailor setup update` to regenerate existing workflows, after updating `@tailor-platform/sdk` to the version released with this change: older versions of `tailor deploy` ignore `TAILOR_CONFIG_PATH`.
