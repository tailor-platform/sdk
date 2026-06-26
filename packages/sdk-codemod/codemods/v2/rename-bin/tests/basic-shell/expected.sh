#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor deploy
tailor login
@tailor-platform/sdk@latest deploy
npx @tailor-platform/sdk@2.0.0 workspace list
