#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor deploy
tailor login
tailor -p tailor-sdk deploy
@tailor-platform/sdk@latest deploy
npx @tailor-platform/sdk@2.0.0 workspace list
npx -y @tailor-platform/sdk login
npx -f @tailor-platform/sdk login
npx -q @tailor-platform/sdk query
