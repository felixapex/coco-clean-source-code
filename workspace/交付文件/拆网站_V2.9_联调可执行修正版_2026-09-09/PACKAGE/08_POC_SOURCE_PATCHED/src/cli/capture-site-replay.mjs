import path from 'node:path';
import { capturePage } from '../capture/chromium-capture.mjs';
import { crawlSite } from '../site/site-crawler.mjs';
import { writeCaptureBundle } from '../replay/capture-bundle.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const startUrl = arg('--url');
if (!startUrl) {
  console.error('Usage: node src/cli/capture-site-replay.mjs --url https://owned.example.com --out ./replay/owned --max-pages 20');
  process.exit(2);
}
const outputRoot = path.resolve(arg('--out', './artifacts/site-replay'));
const maxPages = Number(arg('--max-pages', '20'));
const chromiumPath = arg('--chromium', '/usr/bin/chromium');
if (!Number.isInteger(maxPages) || maxPages <= 0) throw new Error('--max-pages must be a positive integer');

const crawl = await crawlSite({
  startUrl,
  maxPages,
  captureFn: (url) => capturePage(url, { chromiumPath, timeoutMs: 30000, requestGuard: true }),
});
if (!crawl.pages.length) throw new Error(`No pages captured. Errors: ${JSON.stringify(crawl.errors)}`);
const manifest = await writeCaptureBundle({ startUrl: crawl.startUrl, pages: crawl.pages, outputRoot });
console.log(JSON.stringify({
  startUrl: crawl.startUrl,
  capturedPages: crawl.pages.length,
  errors: crawl.errors,
  replayRoot: outputRoot,
  blobCount: manifest.blobs.length,
}, null, 2));
