#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk deploy --dry-run
npx tailor-sdk deploy -y --profile prod
bunx tailor-sdk deploy --no-cache
tailor-sdk --env-file .env deploy --yes
tailor-sdk --json deploy --dry-run
