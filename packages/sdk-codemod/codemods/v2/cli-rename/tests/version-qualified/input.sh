#!/usr/bin/env bash
set -euo pipefail

npx tailor-sdk@latest crash-report list
pnpm dlx tailor-sdk@1.45.2 crash-report tail --jobId latest
