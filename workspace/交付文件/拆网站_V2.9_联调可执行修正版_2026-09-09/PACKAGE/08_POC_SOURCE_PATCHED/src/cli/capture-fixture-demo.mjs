import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runControlledPoc } from '../poc/run-controlled-poc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outputRoot = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.join(root, 'artifacts', 'demo');
const html = await fs.readFile(path.join(root, 'examples', 'fixture.html'), 'utf8');

const result = await runControlledPoc({ html, outputRoot });
console.log(JSON.stringify({
  captureDir: result.captureDir,
  captureSummary: result.captureSummary,
  families: result.ir.componentFamilies.map((f) => ({ name: f.canonicalName, variants: f.variants, count: f.occurrenceCount, confidence: f.confidence })),
  benchmark: result.benchmark,
}, null, 2));
