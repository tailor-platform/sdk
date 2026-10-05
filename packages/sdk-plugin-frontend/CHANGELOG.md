# @tailor-platform/sdk-plugin-frontend

## 0.1.0

### Minor Changes

- [#2468](https://github.com/tailor-platform/sdk/pull/2468) [`7451944`](https://github.com/tailor-platform/sdk/commit/74519445be5000fcbc0ce0f0bd3c6abfb3275b2f) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `frontendPlugin` from `@tailor-platform/sdk-plugin-frontend` to build and upload frontend assets during `tailor deploy`. Frontend builds can use deployed URLs and public OAuth client IDs as environment variables, and deployment results include uploaded frontend details in `outputs.frontends`.
  
  Add deployment hooks and shared context types to `@tailor-platform/sdk`. Successful `tailor deploy --json` results now include `workspaceId` and `applications` with deployed application, Static Website, and AI Gateway URLs, plus public OAuth client IDs, even when no deploy plugins are configured.

### Patch Changes

- Updated dependencies [[`d160c86`](https://github.com/tailor-platform/sdk/commit/d160c865e0d0b9fce550b3e5a12000ef7108d360), [`e4a0301`](https://github.com/tailor-platform/sdk/commit/e4a0301e24c97f4813f590467e56c50672083abb), [`3c87be0`](https://github.com/tailor-platform/sdk/commit/3c87be0cdfbf3fe8b7cdedbdf0d64339b781c25e), [`7451944`](https://github.com/tailor-platform/sdk/commit/74519445be5000fcbc0ce0f0bd3c6abfb3275b2f), [`7454455`](https://github.com/tailor-platform/sdk/commit/7454455239749dea7cd4660db76769e2fd4ca356), [`608b7eb`](https://github.com/tailor-platform/sdk/commit/608b7eb8e46f8a72464b090f355f5a68f2af1243), [`3296f08`](https://github.com/tailor-platform/sdk/commit/3296f0874bca8c7f3b158abfa8527a34b7812dde), [`69b3234`](https://github.com/tailor-platform/sdk/commit/69b32346618d022695fa9c7e06676eef34b83843), [`efcca78`](https://github.com/tailor-platform/sdk/commit/efcca789538fde0f7f05d8de4854c771b03ebbf0), [`46590a4`](https://github.com/tailor-platform/sdk/commit/46590a460ed382456109b4c440aeb411266a0adb), [`ef00996`](https://github.com/tailor-platform/sdk/commit/ef00996f2b829726aa108f73aa89c81eaf0eb0ae), [`3220bc9`](https://github.com/tailor-platform/sdk/commit/3220bc99ec92b89835f663245d9e896ea5ee62da), [`caa34b4`](https://github.com/tailor-platform/sdk/commit/caa34b450fb92b8993e6f3c29c890918bb69b1f6), [`ae6451e`](https://github.com/tailor-platform/sdk/commit/ae6451e6ab358d058a3cb38503dd222537163e35), [`16175f6`](https://github.com/tailor-platform/sdk/commit/16175f6335e72f5775a2f706b65b043be1058a1e), [`d06f314`](https://github.com/tailor-platform/sdk/commit/d06f3143341a8c4161989e5cd906bda8fbbf5014)]:
  - @tailor-platform/sdk@2.25.0
