#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crash-report list
pnpm exec tailor-sdk crash-report send --file ./latest.crash.log
pnpm exec tailor-sdk workflow start approval --machineuser ci
