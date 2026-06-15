# CLI migration

Use `tailor-sdk login --machine-user` before running `tailor-sdk query --machine-user=ci`.

Use `tailor-sdk --json crashreport list` but leave `other-cli --machineuser=ci` alone.

Do not rewrite unrelated commands such as `other-cli --machineuser=ci`.
