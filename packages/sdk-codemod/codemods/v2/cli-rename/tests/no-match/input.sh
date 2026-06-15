#!/usr/bin/env bash
set -euo pipefail

# Should not match: command name is part of a longer word
pnpm exec tailor-sdk crash-reporter list
# Should not match: bare crash-report not preceded by tailor-sdk
echo "Generated crash-report uploaded"
# Should not match: positional/long-form camelCase identifiers are out of scope
pnpm exec tailor-sdk function logs --executionId abc
pnpm exec tailor-sdk executor jobs my-executor --jobId xyz
# Should not match: longer option names
pnpm exec tailor-sdk login --machineusername ci
