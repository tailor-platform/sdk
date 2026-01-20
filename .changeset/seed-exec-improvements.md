---
"@tailor-platform/sdk": minor
---

feat(seed): improve exec script with colors and embedded config

- Remove yaml package dependency by embedding entity config in exec.mjs
- Replace entityNamespaces with namespaceEntities (Map<namespace, entities[]>)
- Add --yes flag to skip confirmation prompts
- Use node:util styleText for colored output (cyan, green, red, yellow, dim)
- Remove config.yaml generation (no longer needed)
- Improve array formatting in namespaceEntities (one element per line)
