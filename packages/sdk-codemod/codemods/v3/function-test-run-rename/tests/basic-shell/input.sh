#!/bin/sh
tailor function test-run resolvers/add.ts --arg '{"a":1,"b":2}'
tailor function test-run workflows/sample.ts --name validate-order
pnpm exec tailor function test-run build/resolvers/add.js
