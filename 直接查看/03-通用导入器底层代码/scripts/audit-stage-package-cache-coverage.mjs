import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeCachedResourceText } from './lib/capture-validation.mjs';

const root = process.cwd();
const verbose = process.argv.includes('--verbose');
const report = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'full-site-audit', 'stage-component-package-audit.json'), 'utf8'));
const cacheRoot = path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache');
const targets = new Set((report.failures || []).flatMap((failure) => (
  (failure.failures || []).map((item) => String(item.href || '')).filter((href) => /^https?:\/\//i.test(href))
)));
const recovered = new Map();

for (const entry of await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isFile() || !entry.name.endsWith('.resource')) continue;
  const file = path.join(cacheRoot, entry.name);
  const text = await fs.readFile(file, 'utf8');
  const source = text.slice(0, text.indexOf('\n')).replace(/\r$/, '');
  if (!targets.has(source)) continue;
  const decoded = decodeCachedResourceText(text);
  if (!decoded.buffer.length) continue;
  recovered.set(source, {
    source,
    file,
    contentType: decoded.contentType,
    byteLength: decoded.buffer.length,
  });
}

const missing = [...targets].filter((source) => !recovered.has(source));
const byContentType = {};
for (const item of recovered.values()) byContentType[item.contentType] = (byContentType[item.contentType] || 0) + 1;
const missingByHost = {};
const missingByExtension = {};
for (const source of missing) {
  const url = new URL(source);
  missingByHost[url.hostname] = (missingByHost[url.hostname] || 0) + 1;
  const extension = path.extname(url.pathname).toLowerCase() || '(none)';
  missingByExtension[extension] = (missingByExtension[extension] || 0) + 1;
}
const summary = {
  targetCount: targets.size,
  recoveredCount: recovered.size,
  missingCount: missing.length,
  byContentType,
  missingByHost,
  missingByExtension,
  missingSamples: missing.slice(0, 12),
};

console.log(JSON.stringify(verbose ? {
  ...summary,
  recovered: [...recovered.values()],
  missing,
} : summary, null, 2));
