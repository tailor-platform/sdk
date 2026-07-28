---
"@tailor-platform/sdk": major
---

Generate the `Env` interface in `tailor.d.ts` from the type of each `defineConfig({ env })` value instead of the value itself. The resolved value used to be written in as a literal type, so running `generate` or `deploy` with real environment variables loaded stamped those values into a file that is normally committed.

```diff
 interface Env {
-  API_BASE: "https://api.example.com";
-  RETRIES: 3;
-  VERBOSE: true;
+  API_BASE: string;
+  RETRIES: number;
+  VERBOSE: boolean;
 }
```

Run `tailor generate` after upgrading to refresh the file. Code that relied on the literal narrowing — comparing `env.STAGE` against a literal union, for example — has to widen its own types or read the value through a local narrowing check. If a `tailor.d.ts` you already committed contains a sensitive value, treat that value as exposed and rotate it; keep secrets in [Secret Manager](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/services/secret.md) rather than `env`.
