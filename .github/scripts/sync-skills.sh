#!/usr/bin/env bash
# Copy public skills from packages/sdk/agent-skills/ to skills/.
# The bundled copy lives under a non-`skills/` directory so that
# `gh skill`'s recursive `**/skills/*/SKILL.md` match resolves to a
# single entry (the repo-root mirror). Root `skills/` is what both
# `gh skill install` and `npx skills add <repo>` actually pick up.
set -euo pipefail

for skill_dir in packages/sdk/agent-skills/*/; do
  skill_name=$(basename "$skill_dir")
  mkdir -p "skills/$skill_name"
  cp -r "$skill_dir"* "skills/$skill_name/"
  echo "✓ Synced $skill_name"
done
