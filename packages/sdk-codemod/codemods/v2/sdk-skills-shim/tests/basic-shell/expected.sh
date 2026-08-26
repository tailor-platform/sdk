#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor skills add
npx @tailor-platform/sdk skills add --help
npm exec @tailor-platform/sdk skills add
