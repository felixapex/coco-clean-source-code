import fs from 'node:fs/promises';
import path from 'node:path';
import { hashFile, listFiles } from './package-integrity.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const manifestName = 'SHA256SUMS.txt';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(packageRoot, manifestName);
const files = (await listFiles(packageRoot)).filter(file => path.basename(file) !== manifestName);
const lines = [];
for (const file of files) {
  const relativePath = path.relative(packageRoot, file).split(path.sep).join('/');
  lines.push(`${await hashFile(file)}  ${relativePath}`);
}
lines.sort((left, right) => left.slice(66).localeCompare(right.slice(66), 'en'));
const temporaryPath = `${outputPath}.tmp`;
await fs.writeFile(temporaryPath, `${lines.join('\n')}\n`);
await fs.rm(outputPath, { force: true });
await fs.rename(temporaryPath, outputPath);
console.log(JSON.stringify({ manifest: outputPath, entries: lines.length }, null, 2));
