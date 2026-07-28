---
"@tailor-platform/sdk": patch
---

Fail the build when a bundled file imports a module that cannot be resolved. Previously such an import was silently left in the bundle and only failed at runtime after deploy, most often when a nested `tsconfig.json` without `compilerOptions.paths` shadowed the aliases declared in the project root. The error names the unresolved specifier, the importing file, and the `tsconfig.json` the build used. Imports explicitly marked as external by a bundler, such as the platform-provided `tailordb` module, remain unaffected.
