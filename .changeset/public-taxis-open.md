---
"@tailor-platform/tailor-sdk": patch
---

Added user and profile management commands

These commands are primarily for making it easier to manage multiple Tailor Platform accounts. The configured content is saved in `.config/tailor-platform/config.yaml` along with authentication credentials.

```bash
# Login to Tailor Platform (add a new user)
tailor-sdk login

# Create a new profile
tailor-sdk profile create <profile-name> --user <user-email> --workspace-id <workspace-id>

# Apply using a specific profile (no need to specify workspace ID or user credentials)
tailor-sdk apply --profile <profile-name>
# or
TAILOR_PLATFORM_PROFILE=<profile-name> tailor-sdk apply
```
