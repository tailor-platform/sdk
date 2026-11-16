---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-frontend": minor
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk-plugin-tailordb-erd": minor
---

**Breaking change**: The SDK and its plugins now require Node.js 22 (22.22.2 or later), 24 (24.15.0 or later), or 26 and later, instead of 22.18.0 or later; Node.js 23 and 25 are no longer supported. The CLI's interactive prompt dependencies already required these versions, so Yarn 1, and pnpm with `engine-strict`, could not install the SDK on other versions. Upgrade Node.js to a supported version. On an unsupported version, npm resolves a version range such as `^2.41.0` to an earlier SDK release that supports it, when the range admits one; otherwise, including a bare `npm install @tailor-platform/sdk`, npm installs with an `EBADENGINE` warning, or fails with `engine-strict`.
