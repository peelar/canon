import { createCliRenderer, type KeyEvent } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import type { Context } from "./repo";
import { loadRules } from "./compile";
import { afterEdit, approve, compile, reject, retire } from "./actions";
import { LEVELS, type Rule, type Status } from "./records";

const FILTERS = [
  { name: "review queue", statuses: ["candidate"] },
  { name: "active", statuses: ["active", "enforced"] },
  { name: "all", statuses: ["candidate", "active", "enforced", "rejected", "retired"] },
] as const;

const COLOR: Record<Status, string> = {
  candidate: "#e0af68",
  active: "#9ece6a",
  enforced: "#7dcfff",
  rejected: "#f7768e",
  retired: "#565f89",
};
const DIM = "#787c99";
const ORDER: Status[] = ["candidate", "active", "enforced", "retired", "rejected"];

type Row = { kind: "heading"; label: string } | { kind: "rule"; rule: Rule };

function rowsFor(rules: Rule[], statuses: readonly Status[]): Row[] {
  const rows: Row[] = [];
  for (const level of LEVELS) {
    const rs = rules
      .filter((r) => r.level === level && statuses.includes(r.status))
      .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.id.localeCompare(b.id));
    if (!rs.length) continue;
    rows.push({ kind: "heading", label: `${level} (${rs.length})` });
    for (const rule of rs) rows.push({ kind: "rule", rule });
  }
  return rows;
}

function load(ctx: Context): { rules: Rule[]; error?: string } {
  try {
    return { rules: loadRules(ctx) };
  } catch (e) {
    return { rules: [], error: (e as Error).message };
  }
}

function Detail({ rule, full }: { rule: Rule; full: boolean }) {
  const field = (label: string, value: string | undefined, fg = "#c0caf5") =>
    value ? (
      <text key={label}>
        <span fg={DIM}>{label.padEnd(12)}</span>
        <span fg={fg}>{value}</span>
      </text>
    ) : null;
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text>
        <strong fg="#c0caf5">{rule.id}</strong>
        <span fg={DIM}>{`  ${rule.level} · v${rule.version} · `}</span>
        <span fg={COLOR[rule.status]}>{rule.status}</span>
      </text>
      <text> </text>
      <text fg={DIM}>Rule</text>
      <text fg="#c0caf5" wrapMode="word">
        {rule.statement}
      </text>
      <text> </text>
      <text fg={DIM}>Why</text>
      <text fg="#a9b1d6" wrapMode="word">
        {full ? rule.rationale || "(no rationale)" : (rule.rationale.split(/\n\s*\n/)[0] ?? "") || "(no rationale)"}
      </text>
      <text> </text>
      {field("Applies to", rule.applies_to?.join(", "))}
      {field("Enforcement", rule.enforcement + (rule.check ? ` · ${rule.check}` : ""))}
      {field("Conflicts", rule.conflicts?.join(", "), "#f7768e")}
      {field("Reason", rule.reason, COLOR[rule.status])}
      <text> </text>
      <text fg={DIM}>Provenance</text>
      {rule.provenance.length ? (
        rule.provenance.map((p) => (
          <text key={p} fg="#7aa2f7">
            {`  ${p}`}
          </text>
        ))
      ) : (
        <text fg={DIM}>  (none)</text>
      )}
      <text> </text>
      <text fg={DIM} wrapMode="char">
        {rule.path}
      </text>
    </box>
  );
}

function App({ ctx, quit }: { ctx: Context; quit: () => void }) {
  const renderer = useRenderer();
  const [data, setData] = useState(() => load(ctx));
  const [filter, setFilter] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [full, setFull] = useState(false);
  const [prompt, setPrompt] = useState<null | "reject" | "retire">(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const rows = rowsFor(data.rules, FILTERS[filter]!.statuses);
  const ruleRows = rows.flatMap((r, i) => (r.kind === "rule" ? [i] : []));
  const at = Math.min(cursor, Math.max(ruleRows.length - 1, 0));
  const selected = ruleRows.length ? (rows[ruleRows[at]!] as { rule: Rule }).rule : undefined;
  const queue = data.rules.filter((r) => r.status === "candidate").length;

  const refresh = () => setData(load(ctx));
  const act = (fn: () => string) => {
    try {
      setMessage({ text: fn(), ok: true });
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    }
    refresh();
  };

  const edit = async (rule: Rule) => {
    await renderer.suspend();
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", rule.path], { stdio: ["inherit", "inherit", "inherit"] });
    await renderer.resume();
    act(() => {
      const r = afterEdit(ctx, rule);
      return `saved ${r.id} (v${r.version}) and compiled`;
    });
  };

  useKeyboard((key: KeyEvent) => {
    if (prompt) {
      if (key.name === "escape") setPrompt(null);
      return;
    }
    const k = key.name;
    if (k === "q" || (key.ctrl && k === "c")) return quit();
    if (k === "escape") return full ? setFull(false) : quit();
    if (k === "down" || k === "j") setCursor(Math.min(at + 1, ruleRows.length - 1));
    else if (k === "up" || k === "k") setCursor(Math.max(at - 1, 0));
    else if (k === "tab") {
      setFilter((filter + (key.shift ? FILTERS.length - 1 : 1)) % FILTERS.length);
      setCursor(0);
    } else if (k === "return") setFull(!full);
    else if (k === "c")
      act(() => {
        const p = compile(ctx);
        return p.outputs.length ? `compiled: ${p.outputs.length} file(s) updated` : "compiled: outputs already up to date";
      });
    else if (!selected) return;
    else if (k === "a")
      act(() => {
        const r = approve(ctx, selected.id);
        return `approved ${r.id}: now ${r.status} v${r.version}, compiled`;
      });
    else if (k === "r" && selected.status === "candidate") setPrompt("reject");
    else if (k === "t" && (selected.status === "active" || selected.status === "enforced")) setPrompt("retire");
    else if (k === "e") void edit(selected);
  });

  const submitReason = (reason: string) => {
    const kind = prompt;
    setPrompt(null);
    if (!selected || !kind) return;
    act(() => {
      const r = kind === "reject" ? reject(ctx, selected.id, reason) : retire(ctx, selected.id, reason);
      return `${kind === "reject" ? "rejected" : "retired"} ${r.id}`;
    });
  };

  const keys = prompt
    ? "enter confirm · esc cancel"
    : `↑↓ move · tab filter · enter ${full ? "split view" : "full rule"} · a approve · r reject · t retire · e edit · c compile · q quit`;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor="#1f2335">
        <text>
          <strong fg="#7aa2f7">canon</strong>
          <span fg={DIM}>{`  ${ctx.key}  ·  `}</span>
          <span fg={COLOR.candidate}>{`${queue} awaiting review`}</span>
        </text>
      </box>
      <box flexDirection="row" paddingLeft={1} gap={2}>
        {FILTERS.map((f, i) => (
          <text key={f.name} fg={i === filter ? "#c0caf5" : DIM}>
            {i === filter ? <u>{f.name}</u> : f.name}
          </text>
        ))}
      </box>
      {data.error ? (
        <box border borderColor="#f7768e" padding={1} flexGrow={1}>
          <text fg="#f7768e" wrapMode="word">
            {data.error}
          </text>
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1}>
          {!full && (
            <box border borderColor="#414868" title=" rules " width={44} flexDirection="column">
              {rows.length ? (
                rows.map((row, i) =>
                  row.kind === "heading" ? (
                    <text key={`h-${row.label}`} fg={DIM}>
                      <strong>{row.label.toUpperCase()}</strong>
                    </text>
                  ) : (
                    <box key={row.rule.path} backgroundColor={ruleRows[at] === i ? "#2e3c64" : undefined}>
                      <text>
                        <span fg={COLOR[row.rule.status]}>{row.rule.status === "candidate" ? " ● " : " ○ "}</span>
                        <span fg="#c0caf5">{row.rule.id.slice(0, 26).padEnd(27)}</span>
                        <span fg={COLOR[row.rule.status]}>{row.rule.status.slice(0, 9).padEnd(10)}</span>
                      </text>
                    </box>
                  ),
                )
              ) : (
                <text fg={DIM}>{filter === 0 ? " Nothing to review." : " No rules."}</text>
              )}
            </box>
          )}
          <box border borderColor="#414868" title={full ? " rule " : " detail "} flexGrow={1}>
            {selected ? <Detail rule={selected} full={full} /> : <text fg={DIM}> Select a rule.</text>}
          </box>
        </box>
      )}
      {prompt && (
        <box border borderColor={COLOR.candidate} title={` ${prompt} ${selected?.id}: reason `} height={3}>
          <input focused placeholder="why? (required)" onSubmit={(v: unknown) => submitReason(String(v))} />
        </box>
      )}
      {message && (
        <text fg={message.ok ? "#9ece6a" : "#f7768e"} wrapMode="word">
          {` ${message.text}`}
        </text>
      )}
      <box paddingLeft={1} backgroundColor="#1f2335">
        <text fg={DIM}>{keys}</text>
      </box>
    </box>
  );
}

export async function runTui(ctx: Context): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  await new Promise<void>((resolve) => {
    const quit = () => {
      renderer.destroy();
      resolve();
    };
    createRoot(renderer).render(<App ctx={ctx} quit={quit} />);
  });
}
