#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk apply --dry-run
npx tailor-sdk apply -y --profile prod
bunx tailor-sdk apply --no-cache
