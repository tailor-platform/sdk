#!/bin/sh
tailor function run resolvers/add.ts --arg '{"a":1,"b":2}'
tailor function run workflows/sample.ts --name validate-order
pnpm exec tailor function run build/resolvers/add.js
