---
"@tailor-platform/sdk": minor
---

Add `authconnection open` command to open the auth connections page in the Tailor Platform Console. The `authconnection authorize` command now also points to this Console flow when the local callback server cannot be started, and the auth connection docs note that managing connections via `tailor.config.ts` does not work today (each deploy recreates the connection and discards its token) — create connections and tokens from the Console instead.
