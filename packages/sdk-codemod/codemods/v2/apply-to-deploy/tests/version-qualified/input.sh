#!/usr/bin/env bash
set -euo pipefail

npx tailor-sdk@latest apply --dry-run
pnpm dlx tailor-sdk@1.45.2 apply -y
