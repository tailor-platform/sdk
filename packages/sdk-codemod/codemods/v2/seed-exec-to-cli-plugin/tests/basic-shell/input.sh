#!/usr/bin/env bash
set -euo pipefail

node ./seed/exec.mjs --truncate --yes
node .tailor-sdk/exec.mjs validate
node --env-file=.env ./seed/exec.mjs -n my-db User Order
node scripts/build.mjs
