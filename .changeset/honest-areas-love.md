---
"@tailor-platform/sdk": patch
---

Fix bundling of a `.start()` call on a local variable that shares its name with an imported workflow or job when the variable is declared in a `switch` case, a named class expression, a namespace, or a static block. The bundler rewrote the call or failed instead of leaving it as written.
