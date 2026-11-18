---
name: canon
description: Reads and proposes coding conventions with the canon CLI. Use when the user corrects how you did something and the correction is a rule for future work ("we always use X", "don't do Y in this repo", "remember that..."), when they ask you to remember a convention or add one to AGENTS.md, or when you need this repo's active rules and the reasons behind them. Not for one-off fixes that only concern the current task.
---

# canon

canon keeps coding conventions as one record per rule, with a status: candidate, active, enforced, rejected, or retired. A person approves each rule, and `canon compile` writes the approved ones into the files each agent reads: AGENTS.md, AGENTS.override.md, CLAUDE.local.md, and Amp's global AGENTS.md. Your part is to read rules and to propose new ones. A proposal stays a candidate until the user approves it in their terminal.

## Rules

- Record a convention with `canon propose`. Do not write it into AGENTS.md, CLAUDE.md, CLAUDE.local.md, AGENTS.override.md, `.canon/`, or `~/.config/canon/` yourself: the records there change only through canon commands, and the other files are outputs that `canon compile` overwrites.
- Leave every decision to the user. Never run `canon approve`, `canon reject`, or `canon retire`, and never launch `canon` or `canon tui`: that is the user's interactive review queue and it waits for keyboard input.
- After proposing, tell the user the rule id and that they can review it by running `canon` in their terminal.

## Read the rules

Approved rules are already in your context through the compiled files. Read them as records when you need a rule's scope, rationale, or check:

- `canon list --json`: active and enforced rules for this repo, each with `id`, `level` (personal, project, or org), `statement`, `rationale`, `applies_to`, `check`, and `provenance`.
- `canon show <id> --json`: one rule.
- `canon list --all --json`: also candidates, rejected, and retired rules. Run it before you propose, so you don't repeat an open candidate or a rule the user rejected; a rejected rule's `reason` says why.

## Propose a rule

Propose when the user corrects you on how work should be done here in general, even if they don't call it a rule. Propose once per convention, at the moment of the correction, and keep doing the task the corrected way.

Example: the user says "don't use npm here, this repo is bun only, the lockfile breaks otherwise." Run:

```bash
canon propose --json \
  --statement 'Use bun for installs and scripts, never npm or yarn.' \
  --why 'The repo is bun only; npm writes a second lockfile that breaks installs.' \
  --provenance 'https://ampcode.com/threads/T-...#message-12'
```

- `--statement`: one imperative sentence that makes sense to someone who never saw this conversation.
- `--why`: the user's reason, close to their words. If they gave none, say what went wrong that led to the correction.
- `--provenance`: a link to the moment the convention came up, repeatable. Use the thread URL (in Amp, the Amp Thread URL from your environment), a PR or review comment URL, or, in Claude Code or Codex, the session transcript path or session id.
- `--owner`: leave it out for the default, `personal`: only this user, only this repo, never committed. Pass `--owner project` only when the user says the rule is for the whole team; that writes a candidate into `.canon/` that goes through code review with their change.
- `--applies-to '<glob>'`: repeatable, when the rule covers only part of the repo, such as `'src/api/**'`.
- `--id <slug>`: optional; otherwise canon derives one from the statement.

Wrap values in single quotes so backticks and `$` reach canon unchanged. Exit 2 means a usage problem, such as a missing flag or an id that already exists; the message says which.

## When compiled files look stale

If a rule the user says they approved is missing from your context, run `canon compile --check`. Exit 1 lists the stale files; run `canon compile` to regenerate them, which only writes from approved records. Tell the user when that changed AGENTS.md, since that file is committed. If compile fails because two active rules conflict or one id exists at two levels, report the message to the user instead of changing records.
