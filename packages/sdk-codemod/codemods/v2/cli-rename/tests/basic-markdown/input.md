# CLI migration

Use `tailor-sdk login --machineuser` before running `tailor-sdk query --machineuser=ci`.

Use `tailor-sdk --json crash-report list` but leave `other-cli --machineuser=ci` alone.

Do not rewrite unrelated commands such as `other-cli --machineuser=ci`.
