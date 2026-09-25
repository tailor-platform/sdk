#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crash-report list
pnpm exec tailor-sdk crash-report send --file ./latest.crash.log
pnpm exec tailor-sdk workflow start approval --machineuser ci
tailor-sdk query --query 'select 1' --machineuser ci
tailor-sdk query 2>&1 --machineuser ci
tailor-sdk query $(build-query --machineuser=ci) --machineuser ci
tailor-sdk query --query 'select 1;' --machineuser ci
tailor-sdk query --query "select 1 | 2" --machineuser ci
tailor-sdk workflow start approval --arg '{"ok":true}' \
  --machineuser ci
tailor-sdk --json crash-report list
TOKEN=$(tailor-sdk query --machineuser ci) other-cli --machineuser=ci
