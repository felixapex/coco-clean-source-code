import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = path.join(root, 'dist');
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, 'app'), { recursive: true });
await fs.mkdir(path.join(dist, 'vendor'), { recursive: true });
const tscEntry = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
for (const file of ['index.css', 'design-tokens.css', 'component-styles.css', 'layout.css']) {
  await fs.copyFile(path.join(root, 'src', file), path.join(dist, 'app', file));
}
await fs.copyFile(path.join(root, 'vendor', 'react-poc-runtime.js'), path.join(dist, 'vendor', 'react-poc-runtime.js'));
try {
  await fs.cp(path.join(root, 'src', 'replay'), path.join(dist, 'replay'), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const componentDir = path.join(dist, 'app', 'components');
const pageDir = path.join(dist, 'app', 'pages');
const stripModuleSyntax = (source) => source.replace(/^import .*?;\n/gm, '').replace(/\bexport\s+(?=(function|const|let|var|class)\b)/g, '');
const componentFiles = (await fs.readdir(componentDir)).filter((name) => name.endsWith('.js')).sort();
const pageFiles = (await fs.readdir(pageDir)).filter((name) => name.endsWith('.js')).sort();
const chunks = [];
for (const name of componentFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(componentDir, name), 'utf8')));
for (const name of pageFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(pageDir, name), 'utf8')));
chunks.push(stripModuleSyntax(await fs.readFile(path.join(dist, 'app', 'main.js'), 'utf8')));
await fs.writeFile(path.join(dist, 'app.js'), chunks.join('\n'), 'utf8');
await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/index.css"></head><body><div id="root"></div><script src="/vendor/react-poc-runtime.js"></script><script src="/app.js"></script></body></html>\n');
console.log(JSON.stringify({ ok: true, dist }, null, 2));
