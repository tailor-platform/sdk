# CLI migration

Use `tailor-sdk login --machine-user` before running `tailor-sdk query --machine-user=ci`.

Use `tailor-sdk --json crashreport list` but leave `other-cli --machineuser=ci` alone.

Use `pnpm exec tailor-sdk login --machine-user` but leave `other-cli --machineuser=ci` alone.

Use tailor-sdk login --machineuser before running other-cli --machineuser=ci.

Do not rewrite unrelated commands such as `other-cli --machineuser=ci`.
