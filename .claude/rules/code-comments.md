---
paths:
  - "**"
---

# Code Comments

Comments are for constraints the code cannot express. Everything else — what the next line does, why a change is correct, investigation notes, history — belongs in the commit message or PR description, not in the file.

- Default to no comment. If something needs explaining, first try renaming or restructuring instead.
- Match the comment density and style of the surrounding file: if neighbors use one-line comments, write one line.
- Never paste analysis, race explanations, or PR rationale into source or config comments.
