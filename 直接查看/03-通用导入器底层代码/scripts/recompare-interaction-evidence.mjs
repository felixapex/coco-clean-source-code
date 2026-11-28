import fs from 'node:fs/promises';
import path from 'node:path';
import { compareInteractionInventories } from './lib/interaction-parity.mjs';

const inputArg = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length);
const outputArg = process.argv.find((item) => item.startsWith('--output='))?.slice('--output='.length);
if (!inputArg || !outputArg) throw new Error('Usage: node scripts/recompare-interaction-evidence.mjs --input=<report.json> --output=<report.json>');
const input = path.resolve(process.cwd(), inputArg);
const output = path.resolve(process.cwd(), outputArg);
const report = JSON.parse(await fs.readFile(input, 'utf8'));
const routePairs = new Map();
for (const failure of report.failures || []) {
  if (!failure.sourceControl || !failure.localControl || !failure.fingerprint) continue;
  const route = failure.route || '/';
  const pairs = routePairs.get(route) || new Map();
  if (!pairs.has(failure.fingerprint)) pairs.set(failure.fingerprint, { source: failure.sourceControl, local: failure.localControl });
  routePairs.set(route, pairs);
}
const expected = Number(report.comparedControlCount || 0);
const saved = [...routePairs.values()].reduce((sum, pairs) => sum + pairs.size, 0);
if (saved !== expected || expected !== Number(report.sourceControlCount || 0) || expected !== Number(report.localControlCount || 0)) {
  throw new Error(`Persisted evidence is incomplete: expected=${expected} savedPairs=${saved} source=${report.sourceControlCount} local=${report.localControlCount}`);
}
const failures = [];
const routeResults = (report.routeResults || []).map((routeResult) => {
  const pairs = routePairs.get(routeResult.route) || new Map();
  const source = [...pairs.values()].map((pair) => pair.source);
  const local = [...pairs.values()].map((pair) => pair.local);
  const comparison = compareInteractionInventories({ source, local, sourceOrigin: report.sourceOrigin });
  failures.push(...comparison.failures.map((failure) => ({ route: routeResult.route, ...failure })));
  return { ...routeResult, comparedCount: comparison.comparedCount, pass: comparison.pass };
});
const recomputed = {
  ...report,
  generatedAt: new Date().toISOString(),
  recomputedFrom: input,
  routeResults,
  failures,
  pass: routeResults.length === report.routeCount && failures.length === 0,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(recomputed, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ pass: recomputed.pass, comparedControls: recomputed.comparedControlCount, failures: failures.length, output }, null, 2)}\n`);
if (!recomputed.pass) process.exitCode = 1;

