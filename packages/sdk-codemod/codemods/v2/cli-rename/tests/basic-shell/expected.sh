#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crashreport list
pnpm exec tailor-sdk crashreport send --file ./latest.crash.log
