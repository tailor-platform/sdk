---
"@tailor-platform/sdk": minor
---

Default to JSON output when an AI coding agent such as Claude Code, Codex, Cursor, or Gemini CLI runs `tailor`, so the agent reads parseable output even without the bundled agent skill, and start `--help` with guidance for the agent. Pass `--json=false` or set `TAILOR_JSON_OUTPUT=false` to keep table output under an agent, or set `POLITTY_NO_AGENT=1` to turn agent detection off. CLI plugins keep their current output.
