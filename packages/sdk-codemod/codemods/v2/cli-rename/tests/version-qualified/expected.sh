#!/usr/bin/env bash
set -euo pipefail

npx tailor-sdk@latest crashreport list
pnpm dlx tailor-sdk@1.45.2 crashreport send --file ./latest.crash.log
