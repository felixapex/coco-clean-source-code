import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchBinaryWithChrome } from './lib/browser-binary-fetch.mjs';

function argument(name) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const url = argument('url');
const output = argument('output');
const expectedPrefix = argument('expected-prefix') || '';
const expectedContentType = argument('expected-content-type') || '';
const contextUrl = argument('context-url') || '';
const browserPath = process.env.MATBOX_CHROMIUM_PATH;
if (!url || !output) throw new Error('Usage: node scripts/fetch-binary-with-chrome.mjs --url=<url> --output=<path> [--expected-prefix=%PDF-]');
const profileDir = path.resolve('artifacts', 'browser-profiles', `binary-fetch-${process.pid}`);
const result = await fetchBinaryWithChrome(url, { browserPath, profileDir, expectedPrefix, expectedContentType, contextUrl });
const outputPath = path.resolve(output);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, result.buffer);
console.log(JSON.stringify({ ok: true, url, responseUrl: result.responseUrl, contentType: result.mimeType, status: result.status, output: outputPath, byteLength: result.buffer.length }, null, 2));
