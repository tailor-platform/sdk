---
"@tailor-platform/sdk": patch
---

Fix deploy silently skipping a secret update after the remote value changed outside the current project directory (a deploy from another machine, or a console-side edit). Deploy now verifies each secret's last platform update time before skipping and re-updates the secret when it no longer matches. After upgrading, the first deploy re-pushes managed secrets once.
