import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildZendeskRequestPage } from './lib/zendesk-request-page.mjs';

const [shellPath, outputPath] = process.argv.slice(2);
if (!shellPath || !outputPath) {
  console.error('Usage: node scripts/build-zendesk-request-source.mjs <official-shell.html> <output.html>');
  process.exit(1);
}

const sourceUrl = 'https://cocorepublichelp.zendesk.com/hc/en-us/requests/new';
const shell = fs.readFileSync(path.resolve(shellPath), 'utf8');
const html = buildZendeskRequestPage(shell, { locale: 'en-us', sourceUrl });

const resolvedOutput = path.resolve(outputPath);
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
fs.writeFileSync(resolvedOutput, html, 'utf8');

console.log(JSON.stringify({ sourceUrl, output: resolvedOutput, bytes: Buffer.byteLength(html) }, null, 2));
