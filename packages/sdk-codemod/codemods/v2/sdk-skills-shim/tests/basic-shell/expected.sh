#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk skills install
npx tailor-sdk skills install --help
