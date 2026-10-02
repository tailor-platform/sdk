---
"@tailor-platform/sdk": minor
---

Add an `additionalNamespaces` option to `kyselyTypePlugin` so `getDB()` can query TailorDB namespaces defined in another application's `tailor.config.ts`. Omit an entry's `namespaces` to include every namespace that config defines without `external: true`. Generation-time plugins also receive `loadTailorDB()` in the `onTailorDBReady` context to load such namespaces. Custom plugins that build the `onTailorDBReady` context by hand, such as in tests, must now provide `loadTailorDB`.
