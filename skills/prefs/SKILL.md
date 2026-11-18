---
name: prefs
description: Reads and proposes coding conventions with the prefs CLI. Use when the user corrects how you did something and the correction is a rule for future work ("we always use X", "don't do Y in this repo", "remember that..."), when they ask you to remember a convention or add one to AGENTS.md, or when you need this repo's active rules and the reasons behind them. Not for one-off fixes that only concern the current task.
---

# prefs

This file is a pointer. The instructions live in the installed `prefs` CLI so they always match its version.

Before anything else, load them and follow them:

```bash
prefs skill show
```

If `prefs` is not on PATH, ask the user to install it (clone the prefs repo, then `bun install && bun link`).
