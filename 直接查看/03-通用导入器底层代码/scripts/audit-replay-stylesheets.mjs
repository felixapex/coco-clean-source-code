import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const files = (await fs.readdir(replayRoot)).filter((name) => name.endsWith('.html'));
const failures = [];
let externalStylesheetCount = 0;

for (const file of files) {
  const html = await fs.readFile(path.join(replayRoot, file), 'utf8');
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    if (!/\brel=["'][^"']*\bstylesheet\b/i.test(tag)) return null;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim() || '';
    return href && !/^(?:data:|blob:)/i.test(href) ? href : null;
  }).filter(Boolean);
  if (!links.length) continue;
  externalStylesheetCount += links.length;
  failures.push({
    file,
    externalStylesheets: links,
    frozenStylesheetCount: (html.match(/data-matbox-frozen-stylesheet/gi) || []).length,
    dataStylesheetCount: (html.match(/<link\b[^>]*href=["']data:text\/css/gi) || []).length,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  replayFileCount: files.length,
  filesWithExternalStylesheets: failures.length,
  externalStylesheetCount,
  failures,
};
const fileFilter = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
if (fileFilter) {
  process.stdout.write(`${JSON.stringify(failures.find((failure) => failure.file === fileFilter) || null, null, 2)}\n`);
} else if (process.argv.includes('--summary')) {
  process.stdout.write(`${JSON.stringify({
    ...report,
    failures: undefined,
    zeroFrozenFailures: failures.filter((failure) => failure.frozenStylesheetCount === 0 && failure.dataStylesheetCount === 0).length,
    helpCentreFailure: failures.find((failure) => failure.file === 'route-hc-en-us.html') || null,
  }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
