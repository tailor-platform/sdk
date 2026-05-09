#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crashreport list
pnpm exec tailor-sdk executor jobs --execution-id abc123
pnpm exec tailor-sdk workflow show --executor-name onUserCreated
pnpm exec tailor-sdk workflow logs --job-id=def456
