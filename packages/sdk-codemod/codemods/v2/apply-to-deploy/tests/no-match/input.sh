#!/usr/bin/env bash
set -euo pipefail

# Should not match: bare `apply` without `tailor-sdk` prefix is a generic word
echo "How to apply this configuration"
# Should not match: hypothetical sibling subcommand starting with `apply-`
pnpm exec tailor-sdk apply-foo
# Should not match: word continuation
pnpm exec tailor-sdk applyConfig
# Should not match: wrapper or unrelated binary names
tailor-sdk-wrapper apply --yes
my-tailor-sdk apply --yes
