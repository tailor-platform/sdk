#!/usr/bin/env bash
set -euo pipefail

tailor seed apply --truncate --yes
tailor seed validate
tailor seed apply --env-file .env -n my-db User Order
node scripts/build.mjs
