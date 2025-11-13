#!/usr/bin/env bash

ENDPOINT="$(pnpm exec tailor-sdk show -f json | jq -r '.url' || true)/query"
HEADER="{ \"Authorization\": \"Bearer $(pnpm exec tailor-sdk machineuser token "manager-machine-user" -f json | jq -r '.access_token' || true)\" }"
gql-ingest -c seed -e "${ENDPOINT}" --headers "${HEADER}"
