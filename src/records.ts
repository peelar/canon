import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parse, stringify } from "smol-toml";

export const LEVELS = ["org", "project", "personal"] as const;
export const STATUSES = ["candidate", "active", "enforced", "rejected", "retired"] as const;
export const ENFORCEMENTS = ["prompt", "lint", "hook"] as const;
export type Level = (typeof LEVELS)[number];
export type Status = (typeof STATUSES)[number];
export type Enforcement = (typeof ENFORCEMENTS)[number];

/** Frontmatter fields, in the order they are written. */
export interface Frontmatter {
  id: string;
  owner: Level;
  status: Status;
  version: number;
  applies_to?: string[];
  enforcement: Enforcement;
  check?: string;
  conflicts?: string[];
  provenance: string[];
  reason?: string;
}

export interface Rule extends Frontmatter {
  /** Level the record was found at (its directory), which must match owner. */
  level: Level;
  path: string;
  statement: string;
  rationale: string;
  body: string;
}

export const COMPILED: Status[] = ["active", "enforced"];
export const isCompiled = (r: { status: Status }) => COMPILED.includes(r.status);

const FENCE = "+++";

export function splitRecord(text: string): { toml: string; body: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) throw new Error("missing +++ frontmatter at the top");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === FENCE);
  if (end < 0) throw new Error("unterminated +++ frontmatter");
  return { toml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n").replace(/^\n/, "") };
}

export function joinRecord(fm: Frontmatter, body: string): string {
  const ordered: Record<string, unknown> = {};
  for (const key of ["id", "owner", "status", "version", "applies_to", "enforcement", "check", "conflicts", "provenance", "reason"] as const) {
    const v = fm[key];
    if (v === undefined || (Array.isArray(v) && v.length === 0 && key !== "provenance")) continue;
    ordered[key] = v;
  }
  return `${FENCE}\n${stringify(ordered).trimEnd()}\n${FENCE}\n\n${body.replace(/^\n+/, "")}`;
}

/** The statement is the body's first paragraph; the rationale is the `## Why` section. */
export function splitBody(body: string): { statement: string; rationale: string } {
  const why = body.search(/^## Why\s*$/m);
  const head = why >= 0 ? body.slice(0, why) : body;
  const statement = head.trim().split(/\n\s*\n/)[0]?.trim() ?? "";
  const rationale = why >= 0 ? body.slice(why).replace(/^## Why\s*\n/, "").split(/^## /m)[0]!.trim() : "";
  return { statement, rationale };
}

export function makeBody(statement: string, rationale: string): string {
  return `${statement.trim()}\n\n## Why\n\n${rationale.trim()}\n`;
}

function validate(fm: Record<string, unknown>, path: string, level: Level): Frontmatter {
  const fail = (msg: string): never => {
    throw new Error(`${path}: ${msg}`);
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]): T => {
    const v = fm[key];
    if (typeof v !== "string" || !values.includes(v as T)) fail(`${key} must be one of ${values.join(", ")}`);
    return v as T;
  };
  const strings = (key: string): string[] | undefined => {
    const v = fm[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail(`${key} must be a list of strings`);
    return v as string[];
  };
  const id = fm.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) fail("id must be lowercase letters, digits, and dashes");
  if (basename(path) !== `${id}.md`) fail(`file name must be ${id}.md`);
  const owner = oneOf("owner", LEVELS);
  if (owner !== level) fail(`owner is ${owner} but the record is in the ${level} directory`);
  const version = fm.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) fail("version must be a non-negative integer");
  const status = oneOf("status", STATUSES);
  if ((status === "rejected" || status === "retired") && typeof fm.reason !== "string") fail(`${status} rules need a reason`);
  return {
    id: id as string,
    owner,
    status,
    version: version as number,
    applies_to: strings("applies_to"),
    enforcement: fm.enforcement === undefined ? "prompt" : oneOf("enforcement", ENFORCEMENTS),
    check: typeof fm.check === "string" ? fm.check : undefined,
    conflicts: strings("conflicts"),
    provenance: strings("provenance") ?? [],
    reason: typeof fm.reason === "string" ? fm.reason : undefined,
  };
}

export function readRule(path: string, level: Level): Rule {
  const { toml, body } = splitRecord(readFileSync(path, "utf8"));
  let fm: Record<string, unknown>;
  try {
    fm = parse(toml) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${path}: invalid TOML frontmatter: ${(e as Error).message}`);
  }
  return { ...validate(fm, path, level), level, path, body, ...splitBody(body) };
}

export function readDir(dir: string | undefined, level: Level): Rule[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => readRule(join(dir, f), level));
}

/** Rewrite only the frontmatter of a record; the body bytes stay as they are. */
export function updateFrontmatter(path: string, patch: Partial<Frontmatter>): void {
  const { toml, body } = splitRecord(readFileSync(path, "utf8"));
  const fm = { ...(parse(toml) as unknown as Frontmatter), ...patch };
  writeFileSync(path, joinRecord(fm, body));
}

export function writeNewRule(dir: string, fm: Frontmatter, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fm.id}.md`);
  writeFileSync(path, joinRecord(fm, body), { flag: "wx" });
  return path;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[`'"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .split("-")
      .filter(Boolean)
      .slice(0, 6)
      .join("-") || "rule"
  );
}
