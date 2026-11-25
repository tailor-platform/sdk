#!/bin/sh
tailor function script resolvers/add.ts --arg '{"a":1,"b":2}'
tailor function script workflows/sample.ts --name validate-order
pnpm exec tailor function script build/resolvers/add.js
