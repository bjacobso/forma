import { readFile } from "node:fs/promises";
import { median } from "./harness.mjs";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Usage: node bench/agent/report.mjs <results.json> [more.json]");
const reports = await Promise.all(files.map(async file => JSON.parse(await readFile(file, "utf8"))));
const rows = [["Metric / diagnostic / task", ...files]];
for (const tier of ["core", "hard"]) {
  const tasks = reports.map(report => report.results.filter(result => result.tier === tier));
  rows.push([`${tier} pass rate`, ...tasks.map(results => {
    const passed = results.filter(result => result.pass).length;
    return `${results.length ? `${+(100 * passed / results.length).toFixed(1)}%` : "n/a"} (${passed}/${results.length})`;
  })]);
  rows.push([`${tier} median repair rounds`, ...tasks.map(results => String(median(results.map(result => result.repairRounds)) ?? "n/a"))]);
}
rows.push(["Top diagnostic codes (calls / tasks / attributed repair rounds)"]);
// Take the union of each run's top ten so a code prominent in either run is visible.
const topCodes = new Set(reports.flatMap(report => Object.entries(report.diagnostics ?? {})
  .sort(([a, x], [b, y]) => y.calls - x.calls || a.localeCompare(b)).slice(0, 10).map(([code]) => code)));
for (const code of topCodes) rows.push([code, ...reports.map(report => {
  const counts = report.diagnostics?.[code];
  return counts ? `${counts.calls} calls, ${counts.tasks} tasks, ${counts.repairRoundsAttributed} rounds` : "—";
})]);
rows.push(["Failing codes by task (call order)"]);
const ids = new Set(reports.flatMap(report => report.results.map(result => result.id)));
for (const id of ids) rows.push([id, ...reports.map(report => {
  const result = report.results.find(result => result.id === id);
  if (!result) return "—";
  if (!result.failingCalls) return "unavailable (older report)";
  return result.failingCalls.map(call => call.codes.length ? call.codes.join("+") : "(no code)").join(" -> ") || "(none)";
})]);
const widths = rows[0].map((_, i) => Math.max(...rows.map(row => (row[i] ?? "").length)));
for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd());
