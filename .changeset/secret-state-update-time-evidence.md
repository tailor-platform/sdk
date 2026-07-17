---
"@tailor-platform/sdk": patch
---

Fix deploy silently skipping a secret update after the remote value changed outside the current checkout (a deploy from another machine, or a console-side edit). The local hash state now also records the platform's update timestamp for each secret and distrusts the stored hash when the remote timestamp no longer matches. After upgrading, the first deploy re-pushes managed secrets once to seed the new state format.
