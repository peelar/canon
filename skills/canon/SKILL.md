---
name: canon
description: Reads and proposes coding conventions with the canon CLI. Use when the user corrects how you did something and the correction is a rule for future work ("we always use X", "don't do Y in this repo", "remember that..."), when they ask you to remember a convention or add one to AGENTS.md, or when you need this repo's active rules and the reasons behind them. Not for one-off fixes that only concern the current task.
---

# canon

This file is a pointer. The instructions live in the installed `canon` CLI so they always match its version.

Before anything else, load them and follow them:

```bash
canon skill show
```

If `canon` is not on PATH, ask the user to install it (clone the canon repo, then `bun install && bun link`).
