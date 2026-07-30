#!/usr/bin/env bash
set -euo pipefail

tailor seed apply --truncate --yes
tailor seed validate
tailor seed apply --env-file .env -n my-db User Order
tailor seed apply --env-file-if-exists .env
tailor seed validate data/seed
node scripts/build.mjs
