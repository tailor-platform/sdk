#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crash-report list
pnpm exec tailor-sdk executor jobs --executionId abc123
pnpm exec tailor-sdk workflow show --executorName onUserCreated
pnpm exec tailor-sdk workflow logs --jobId=def456
