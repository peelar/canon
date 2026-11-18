import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";
import type { Level } from "./records";

export function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() };
}

export const home = () => process.env.HOME || homedir();
export const canonHome = () => join(home(), ".config", "canon");

/**
 * `git@github.com:peelar/imp.git`, `https://github.com/peelar/imp`, and
 * `ssh://git@github.com:22/peelar/imp.git` all become `github.com/peelar/imp`.
 */
export function normalizeRemote(url: string): string {
  let u = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(u);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return `${scp[1]!.toLowerCase()}/${scp[2]}`;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
  if (m) return `${m[1]!.toLowerCase()}/${m[2]}`;
  return u;
}

export interface Context {
  cwd: string;
  root: string;
  /** Normalized origin remote, or `local/<checkout path>` without a remote. */
  key: string;
  dirs: Record<Level, string | undefined>;
  excludePath: string;
}

function orgDir(): string | undefined {
  if (process.env.CANON_ORG_DIR) return resolve(process.env.CANON_ORG_DIR);
  const cfg = join(canonHome(), "config.toml");
  if (!existsSync(cfg)) return undefined;
  const dir = (parse(readFileSync(cfg, "utf8")) as { org_dir?: string }).org_dir;
  return dir ? resolve(dir.replace(/^~(?=\/|$)/, home())) : undefined;
}

export function loadContext(cwd = process.cwd()): Context {
  const top = git(cwd, "rev-parse", "--show-toplevel");
  if (!top.ok) throw new Error(`not inside a git repository: ${cwd}`);
  const root = top.out;
  const origin = git(root, "remote", "get-url", "origin");
  const key = origin.ok && origin.out ? normalizeRemote(origin.out) : `local${root}`;
  const excl = git(root, "rev-parse", "--git-path", "info/exclude").out;
  return {
    cwd,
    root,
    key,
    dirs: { project: join(root, ".canon"), org: orgDir(), personal: join(canonHome(), "repos", key) },
    excludePath: resolve(root, excl),
  };
}

export const isTracked = (ctx: Context, rel: string) => git(ctx.root, "ls-files", "--error-unmatch", "--", rel).ok;
