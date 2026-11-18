#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContext } from "./repo";
import { apply, describe, loadRules, plan } from "./compile";
import { approve, findRule, propose, reject, retire, toJSON, UsageError } from "./actions";
import { isCompiled, STATUSES, type Rule } from "./records";

const SKILL_PATH = join(import.meta.dir, "..", "skill", "SKILL.md");

const HELP = `prefs: coding-agent conventions as records with a lifecycle, compiled into each harness's files.

For people:
  prefs                       open the review queue (same as prefs tui)
  prefs approve <id>          candidate -> active (or active -> enforced), bump version, compile
  prefs reject <id> --reason <text>
  prefs retire <id> --reason <text>
  prefs compile [--check] [--only personal]

For agents (all take --json):
  prefs list [--all | --status <s,...>] [--owner <level>]
  prefs show <id>
  prefs propose --statement <text> --why <text> --provenance <url> [--provenance <url>...]
                [--id <id>] [--owner personal|project|org] [--applies-to <glob>...]
                [--enforcement prompt|lint|hook] [--check <cmd>] [--conflicts <id>...]
  prefs skill show | path     print the agent skill bundled with this CLI, or its path
`;

function summary(r: Rule) {
  const scope = r.applies_to?.length ? ` [${r.applies_to.join(", ")}]` : "";
  return `${r.id.padEnd(28)} ${r.level.padEnd(8)} ${r.status.padEnd(9)} v${r.version}  ${r.statement.split("\n")[0]}${scope}`;
}

function humanOnly(cmd: string) {
  if (process.stdin.isTTY || process.env.PREFS_HUMAN === "1") return;
  throw new UsageError(
    `prefs ${cmd} is for people: run it in a terminal, or review in \`prefs tui\`. Agents suggest rules with \`prefs propose\`.`,
  );
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const opts = {
    json: { type: "boolean" },
    all: { type: "boolean" },
    status: { type: "string" },
    owner: { type: "string" },
    reason: { type: "string" },
    check: { type: "boolean" },
    only: { type: "string" },
    quiet: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } as const;
  const out = (json: unknown, text: string) => {
    if (!(values.quiet && !values.json)) console.log(values.json ? JSON.stringify(json, null, 2) : text);
  };
  let values: Record<string, unknown> = {};

  switch (cmd) {
    case undefined:
    case "tui": {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        if (cmd) throw new UsageError("prefs tui is the interactive review queue and needs a terminal; agents use `prefs list --json`");
        console.log(HELP);
        return 0;
      }
      const { runTui } = await import("./tui");
      await runTui(loadContext());
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "skill": {
      const sub = rest[0];
      if (sub === "path") console.log(SKILL_PATH);
      else if (sub === "show") process.stdout.write(readFileSync(SKILL_PATH, "utf8"));
      else throw new UsageError("usage: prefs skill show | prefs skill path");
      return 0;
    }
    case "list": {
      ({ values } = parseArgs({ args: rest, options: opts, strict: true }));
      const ctx = loadContext();
      const statuses = values.all ? [...STATUSES] : values.status ? String(values.status).split(",") : ["active", "enforced"];
      for (const s of statuses) if (!(STATUSES as readonly string[]).includes(s)) throw new UsageError(`unknown status "${s}"`);
      const rules = loadRules(ctx).filter((r) => statuses.includes(r.status) && (!values.owner || r.level === values.owner));
      out({ repo: ctx.key, rules: rules.map(toJSON) }, rules.length ? rules.map(summary).join("\n") : "no matching rules");
      return 0;
    }
    case "show": {
      const { values: v, positionals } = parseArgs({ args: rest, options: opts, strict: true, allowPositionals: true });
      values = v;
      if (!positionals[0]) throw new UsageError("usage: prefs show <id>");
      const r = findRule(loadContext(), positionals[0]);
      out({ rule: { ...toJSON(r), compiled: isCompiled(r) } }, `${readFileSync(r.path, "utf8")}\n(${r.path})`);
      return 0;
    }
    case "propose": {
      const parsed = parseArgs({
        args: rest,
        strict: true,
        options: {
          json: { type: "boolean" },
          statement: { type: "string" },
          why: { type: "string" },
          id: { type: "string" },
          owner: { type: "string" },
          "applies-to": { type: "string", multiple: true },
          provenance: { type: "string", multiple: true },
          enforcement: { type: "string" },
          check: { type: "string" },
          conflicts: { type: "string", multiple: true },
        },
      });
      values = parsed.values;
      const v = parsed.values;
      const r = propose(loadContext(), {
        statement: v.statement ?? "",
        why: v.why ?? "",
        id: v.id,
        owner: v.owner,
        applies_to: v["applies-to"],
        provenance: v.provenance,
        enforcement: v.enforcement,
        check: v.check,
        conflicts: v.conflicts,
      });
      out({ rule: toJSON(r) }, `proposed candidate ${r.id} at ${r.path}\nA person reviews it with \`prefs\` (the TUI) or \`prefs approve ${r.id}\`.`);
      return 0;
    }
    case "approve":
    case "reject":
    case "retire": {
      const { values: v, positionals } = parseArgs({ args: rest, options: opts, strict: true, allowPositionals: true });
      values = v;
      const id = positionals[0];
      if (!id) throw new UsageError(`usage: prefs ${cmd} <id>${cmd === "approve" ? "" : " --reason <text>"}`);
      humanOnly(cmd);
      const ctx = loadContext();
      const r = cmd === "approve" ? approve(ctx, id) : cmd === "reject" ? reject(ctx, id, String(v.reason ?? "")) : retire(ctx, id, String(v.reason ?? ""));
      const written = "compiled" in r ? (r.compiled as string[]) : [];
      out({ rule: toJSON(r) }, [`${r.id} is now ${r.status} (v${r.version})`, ...written].join("\n"));
      return 0;
    }
    case "compile": {
      ({ values } = parseArgs({ args: rest, options: opts, strict: true }));
      if (values.only && values.only !== "personal" && values.only !== "shared") throw new UsageError("--only must be personal or shared");
      const ctx = loadContext();
      const p = plan(ctx, { only: values.only as "personal" | "shared" | undefined });
      for (const w of p.warnings) console.error(`prefs: warning: ${w}`);
      const files = p.outputs.map((o) => ({ path: o.path, kind: o.kind, action: o.content === null ? "remove" : "write" }));
      if (values.check) {
        const stale = p.outputs.map((o) => `  ${describe(ctx, o).replace(/^wrote|^removed/, (m) => (m === "wrote" ? "would write" : "would remove"))}`);
        out({ ok: !files.length, stale: files, warnings: p.warnings }, files.length ? `prefs outputs are stale; run \`prefs compile\`:\n${stale.join("\n")}` : "prefs outputs are up to date");
        return files.length ? 1 : 0;
      }
      apply(p);
      out({ ok: true, written: files, warnings: p.warnings }, files.length ? p.outputs.map((o) => describe(ctx, o)).join("\n") : "prefs outputs are up to date");
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

const json = process.argv.includes("--json");
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    const usage = e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
    if (json) console.log(JSON.stringify({ error: e.message }));
    console.error(e.message.startsWith("prefs") ? e.message : `prefs: ${e.message}`);
    process.exit(usage ? 2 : 1);
  },
);
