#!/usr/bin/env bash
set -euo pipefail

node ./seed/exec.mjs --truncate --yes
node .tailor-sdk/exec.mjs validate
node --env-file=.env ./seed/exec.mjs -n my-db User Order
node --env-file-if-exists .env generated/exec.mjs
node --import tsx src/seed/exec.mjs validate data/seed
node scripts/build.mjs
