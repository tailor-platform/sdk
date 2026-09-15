---
"@tailor-platform/sdk": minor
---

`defineConfig({ env })` values now accept the `<name>:url` static website placeholder, the same one `cors`, OAuth2 redirect URIs, and IdP return origins already accept. On deploy, the CLI replaces such a value with the deployed website's URL before it reaches resolver, executor, workflow job, auth hook, and TailorDB migration script code, so `env.siteUrl` reads `https://<site>.tailor.tech` at runtime instead of the literal string `"my-site:url"`. A path suffix works too (`"my-site:url/callback"`).

When the referenced website is created later in the same deploy run, the value stays as the pattern and the CLI warns that a second deploy injects the URL — matching how `cors` already behaves on a first deployment. An env value that still holds an unresolved placeholder after deployment is always reported as a warning, so the raw pattern no longer reaches application code unnoticed.
