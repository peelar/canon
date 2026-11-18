import { existsSync } from "node:fs";
import { type Context } from "./repo";
import { apply, CompileError, describe, loadRules, plan, validateRules, type Plan } from "./compile";
import { type Enforcement, type Level, type Rule, ENFORCEMENTS, LEVELS, makeBody, slugify, updateFrontmatter, writeNewRule } from "./records";

export class UsageError extends Error {}

export function findRule(ctx: Context, id: string): Rule {
  const matches = loadRules(ctx).filter((r) => r.id === id);
  if (!matches.length) throw new UsageError(`no rule with id "${id}"`);
  if (matches.length > 1) throw new CompileError(`rule "${id}" exists at more than one level: ${matches.map((r) => r.path).join(", ")}`);
  return matches[0]!;
}

export interface Proposal {
  statement: string;
  why: string;
  id?: string;
  owner?: string;
  applies_to?: string[];
  provenance?: string[];
  enforcement?: string;
  check?: string;
  conflicts?: string[];
}

/** Writes a candidate. There is no way to pass a status: proposals never activate anything. */
export function propose(ctx: Context, p: Proposal): Rule {
  if (!p.statement?.trim()) throw new UsageError("--statement is required");
  if (!p.why?.trim()) throw new UsageError("--why is required: say why this convention matters");
  if (!p.provenance?.length) throw new UsageError("--provenance is required: link the thread, PR, or message where the convention came up");
  const owner = (p.owner ?? "personal") as Level;
  if (!LEVELS.includes(owner)) throw new UsageError(`--owner must be one of ${LEVELS.join(", ")}`);
  const enforcement = (p.enforcement ?? "prompt") as Enforcement;
  if (!ENFORCEMENTS.includes(enforcement)) throw new UsageError(`--enforcement must be one of ${ENFORCEMENTS.join(", ")}`);
  const dir = ctx.dirs[owner];
  if (!dir) throw new UsageError("no org prefs directory: set PREFS_ORG_DIR or org_dir in ~/.config/prefs/config.toml");
  const id = p.id ?? slugify(p.statement);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new UsageError("--id must be lowercase letters, digits, and dashes");
  const existing = loadRules(ctx).find((r) => r.id === id);
  if (existing) throw new UsageError(`rule "${id}" already exists (${existing.level}, ${existing.status}); pick another --id`);
  const path = writeNewRule(
    dir,
    {
      id,
      owner,
      status: "candidate",
      version: 0,
      applies_to: p.applies_to,
      enforcement,
      check: p.check,
      conflicts: p.conflicts,
      provenance: p.provenance,
    },
    makeBody(p.statement, p.why),
  );
  return { ...findRule(ctx, id), path };
}

export function compile(ctx: Context): Plan {
  const p = plan(ctx);
  apply(p);
  return p;
}

/** candidate → active, or active → enforced once the rule has a check. Bumps the version. */
/** A rule after a command that recompiled, with what compile wrote. */
export type Compiled = Rule & { compiled: string[] };

const compiled = (ctx: Context, id: string): Compiled => ({ ...findRule(ctx, id), compiled: compile(ctx).outputs.map((o) => describe(ctx, o)) });

export function approve(ctx: Context, id: string): Compiled {
  const r = findRule(ctx, id);
  let status: Rule["status"];
  if (r.status === "candidate") status = "active";
  else if (r.status === "active" && r.enforcement !== "prompt" && r.check) status = "enforced";
  else throw new UsageError(`can't approve "${id}": it is ${r.status}${r.status === "active" ? " and has no lint or hook check to enforce" : ""}`);
  // Refuse before writing anything if activating it would break the build.
  validateRules(loadRules(ctx).map((x) => (x.path === r.path ? { ...x, status } : x)));
  updateFrontmatter(r.path, { status, version: r.version + 1, reason: undefined });
  return compiled(ctx, id);
}

export function reject(ctx: Context, id: string, reason: string): Rule {
  const r = findRule(ctx, id);
  if (r.status !== "candidate") throw new UsageError(`only candidates can be rejected; "${id}" is ${r.status} (use retire)`);
  if (!reason?.trim()) throw new UsageError("--reason is required");
  updateFrontmatter(r.path, { status: "rejected", reason });
  return findRule(ctx, id);
}

export function retire(ctx: Context, id: string, reason: string): Compiled {
  const r = findRule(ctx, id);
  if (r.status !== "active" && r.status !== "enforced") throw new UsageError(`only active or enforced rules can be retired; "${id}" is ${r.status}`);
  if (!reason?.trim()) throw new UsageError("--reason is required");
  updateFrontmatter(r.path, { status: "retired", reason });
  return compiled(ctx, id);
}

/** After a human edits a record by hand: an edited active rule is a new version. */
export function afterEdit(ctx: Context, before: Rule): Rule {
  if (!existsSync(before.path)) throw new UsageError(`${before.path} was removed`);
  const after = findRule(ctx, before.id);
  if (after.body !== before.body && (after.status === "active" || after.status === "enforced") && after.version === before.version) {
    updateFrontmatter(after.path, { version: after.version + 1 });
  }
  compile(ctx);
  return findRule(ctx, before.id);
}

export function toJSON(r: Rule) {
  const { body: _body, ...rest } = r;
  return rest;
}
