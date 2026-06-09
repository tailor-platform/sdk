---
"@tailor-platform/sdk": minor
---

Add `authconnection open` command to open the auth connections page in the Tailor Platform Console. The `authconnection authorize` command now also points to this Console flow when the local callback server cannot be started, and the auth connection docs note that managing connections via `tailor.config.ts` is unreliable for shared and CI deploys (a deploy without the local `.tailor-sdk/` secret state recreates the connection and discards its token) — create connections and tokens from the Console instead.
