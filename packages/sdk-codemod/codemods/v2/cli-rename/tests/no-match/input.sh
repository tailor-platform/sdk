#!/usr/bin/env bash
set -euo pipefail

# Should not match: command name is part of a longer word
pnpm exec tailor-sdk crash-reporter list
# Should not match: option is a prefix of a different flag
pnpm exec tailor-sdk executor show --executionIdExtra value
# Should not match: option has dash continuation, not a hit
pnpm exec tailor-sdk executor show --executionId-foo value
# Should not match: bare crash-report not preceded by tailor-sdk
echo "Generated crash-report uploaded"
