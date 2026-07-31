#!/usr/bin/env bash
# create-tailor-sdk is a scaffolding package, not the CLI binary
npx create-tailor-sdk@latest my-app

# .tailor-sdk directory paths are not the binary
ls .tailor-sdk/cache
cat .tailor-sdk/config.json

# tailor-sdk-skills has a trailing hyphen+word after the base token — not a binary invocation
tailor-sdk-skills
