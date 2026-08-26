#!/usr/bin/env bash
set -euo pipefail

pnpm exec tailor-sdk crashreport list
pnpm exec tailor-sdk crashreport send --file ./latest.crash.log
pnpm exec tailor-sdk workflow start approval --machine-user ci
tailor-sdk query --query 'select 1' --machine-user ci
tailor-sdk query 2>&1 --machine-user ci
tailor-sdk query $(build-query --machineuser=ci) --machine-user ci
tailor-sdk query --query 'select 1;' --machine-user ci
tailor-sdk query --query "select 1 | 2" --machine-user ci
tailor-sdk workflow start approval --arg '{"ok":true}' \
  --machine-user ci
tailor-sdk --json crashreport list
TOKEN=$(tailor-sdk query --machine-user ci) other-cli --machineuser=ci
