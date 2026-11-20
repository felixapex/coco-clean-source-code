import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildZendeskRegistrationPage } from './lib/zendesk-registration-page.mjs';

const [shellPath, outputPath] = process.argv.slice(2);
if (!shellPath || !outputPath) {
  console.error('Usage: node scripts/build-zendesk-registration-source.mjs <official-auth-shell.html> <output.html>');
  process.exit(1);
}

const sourceUrl = 'https://cocorepublichelp.zendesk.com/auth/v3/register';
const shell = fs.readFileSync(path.resolve(shellPath), 'utf8');
const html = buildZendeskRegistrationPage(shell, {
  brandName: 'Coco Republic Australia',
  locale: 'en-us',
  sourceUrl,
});

const resolvedOutput = path.resolve(outputPath);
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
fs.writeFileSync(resolvedOutput, html, 'utf8');
console.log(JSON.stringify({ sourceUrl, output: resolvedOutput, bytes: Buffer.byteLength(html) }, null, 2));
