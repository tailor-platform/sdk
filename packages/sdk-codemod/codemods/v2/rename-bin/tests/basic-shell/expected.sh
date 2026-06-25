#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor deploy
tailor login
tailor@latest deploy
npx tailor@2.0.0 workspace list
