#!/bin/sh
tailor function scaffold resolvers/add.ts --arg '{"a":1,"b":2}'
tailor function scaffold workflows/sample.ts --name validate-order
pnpm exec tailor function scaffold build/resolvers/add.js
