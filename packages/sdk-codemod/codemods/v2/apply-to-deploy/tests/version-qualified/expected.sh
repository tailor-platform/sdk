#!/usr/bin/env bash
set -euo pipefail

npx tailor-sdk@latest deploy --dry-run
pnpm dlx tailor-sdk@1.45.2 deploy -y
