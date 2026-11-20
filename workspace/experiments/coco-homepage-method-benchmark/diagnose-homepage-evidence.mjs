import fs from 'node:fs';
import path from 'node:path';

const runRoot = process.argv[2];
const ids = process.argv.slice(3);
if (!runRoot) throw new Error('usage: node diagnose-homepage-evidence.mjs <run-root> [block-id]...');

for (const name of ['source', 'output']) {
  const html = fs.readFileSync(path.join(runRoot, `${name}.html`), 'utf8');
  if (ids.length === 0) {
    const rootStart = html.indexOf('id="cards-622b573b-f700-447d-aed6-c40badca8425"');
    const rootEnd = html.indexOf('</section>', rootStart);
    const fragment = html.slice(rootStart, rootEnd > rootStart ? rootEnd : rootStart + 200000);
    const imageTags = [...fragment.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]
      .replace(/\s(src|data-src|srcset|data-srcset)="[^"]*"/gi, (value, key) => ` ${key}="[omitted:${value.length}]"`));
    console.log(name, JSON.stringify(imageTags, null, 2));
    continue;
  }
  for (const id of ids) {
    const at = html.indexOf(`data-block-id="${id}"`);
    const start = html.lastIndexOf('<', at);
    const end = html.indexOf('>', at) + 1;
    const tag = at < 0
      ? 'NOT_FOUND'
      : html.slice(start, end).replace(/\s(src|poster)="[^"]*"/gi, (match, key) => ` ${key}="[omitted:${match.length}]"`);
    console.log(name, id, tag);
  }
}
