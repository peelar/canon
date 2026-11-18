// Amp plugin: keeps prefs outputs fresh. Install by copying or symlinking this file to
// ~/.config/amp/plugins/prefs.ts, then run `plugins: reload`. Needs `prefs` on PATH.
import type { PluginAPI } from "@ampcode/plugin";

export const description = "Runs `prefs hook session-start` when a thread starts: refreshes stale personal rule files and warns when AGENTS.md is behind the approved rules.";

interface Report {
  refreshed: string[];
  stale: string[];
  warnings: string[];
  error?: string;
}

export default function (amp: PluginAPI) {
  amp.on("session.start", async (_event, ctx) => {
    const root = amp.system.workspaceRoot;
    if (!root) return;
    let report: Report;
    try {
      // Spawned directly (not ctx.$) so the command runs in the workspace without shell quoting.
      const p = Bun.spawnSync(["prefs", "hook", "session-start", "--json"], { cwd: amp.helpers.filePathFromURI(root), stdout: "pipe", stderr: "pipe" });
      report = JSON.parse(p.stdout.toString());
    } catch (e) {
      ctx.logger.log(`prefs not available: ${(e as Error).message}`);
      return;
    }
    const lines = [
      ...(report.refreshed.length ? [`Refreshed personal rules: ${report.refreshed.join("; ")}.`] : []),
      ...(report.stale.length ? [`${report.stale.join(", ")} is behind the approved rules. Run \`prefs compile\` and commit it.`] : []),
      ...report.warnings,
      ...(report.error ? [report.error] : []),
    ];
    if (lines.length) await ctx.ui.notify(`prefs: ${lines.join("\n")}`);
  });
}
