#!/usr/bin/env bash
set -euo pipefail

tailor-sdk function test-run resolvers/add.ts --arg '{"input":{"a":1,"b":2}}'
tailor-sdk function test-run resolvers/seed.ts -a '{"input":{"users":[]}}'
