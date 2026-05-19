#!/usr/bin/env bash
tailor-sdk function test-run resolvers/add.ts --arg '{"a":1}' && other-cli --arg '{"input":{"keep":true}}'
