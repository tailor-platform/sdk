---
"@tailor-platform/sdk-plugin-setup": patch
---

`tailor setup ci env --check` now warns when `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` is set on the repository or the organization, where any workflow on any branch can read it and the GitHub Environment's protection rules do not guard it, and prints the `gh` commands that move it onto the environment. The check still passes. With `--json`, each entry's `exposedIn` lists where it was found outside its environment.
