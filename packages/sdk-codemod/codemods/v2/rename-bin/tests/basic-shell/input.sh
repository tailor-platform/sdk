#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk deploy
tailor-sdk login
tailor-sdk@latest deploy
npx tailor-sdk@2.0.0 workspace list
