import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditPublishedSiteHtml, collectExternalMediaReferences, decodeCachedResourceText, sanitizePublishedHtml } from './lib/capture-validation.mjs';
import { bigCommerceImageFallbackCandidates } from '../src/import-core/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const siteRoot = path.resolve(process.argv[2] || path.join(root, 'dist'));
const replayRoot = path.join(siteRoot, 'replay');
const outputRoot = path.join(siteRoot, 'frozen-assets', 'external-v3');
const cacheRoot = path.resolve(process.env.MATBOX_RESOURCE_CACHE || path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache'));
const sourceHosts = [
  'cocorepublic.com.au',
  'cocorepublichelp.zendesk.com',
  'store-hkpsknj5ns.mybigcommerce.com',
  'store-mc0jqubfon.mybigcommerce.com',
  'store-r9qus9llfb.mybigcommerce.com',
];
const navigationFallbacks = {
  'cocorepublic.co.nz': '/',
  'viewer.ipaper.io': '/catalogues',
  'republicpropertystyling.com.au': '/interior-design',
  'lamericano.com.au': '/our-showrooms',
  'olessio.com.au': '/olessio-wardrobes',
};
const extensionByType = new Map([
  ['image/avif', '.avif'], ['image/gif', '.gif'], ['image/jpeg', '.jpg'],
  ['image/png', '.png'], ['image/svg+xml', '.svg'], ['image/webp', '.webp'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
]);

function normalizedUrl(value) {
  return String(value || '').replaceAll('&amp;', '&').trim();
}

async function writeFileWithRetry(file, data, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.writeFile(file, data, options);
      return;
    } catch (error) {
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt >= 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function listHtmlFiles(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function extensionFor(url, contentType) {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(?:avif|gif|jpe?g|mp4|png|svg|webm|webp)$/.test(extension)) return extension === '.jpeg' ? '.jpg' : extension;
  } catch {}
  return extensionByType.get(String(contentType || '').split(';')[0].trim().toLowerCase()) || '.bin';
}

async function readFirstLine(file) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(16_384);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newlineIndex = buffer.subarray(0, bytesRead).indexOf(10);
    if (newlineIndex < 0) return '';
    return buffer.subarray(0, newlineIndex).toString('utf8').replace(/\r$/, '');
  } finally {
    await handle.close();
  }
}

async function buildCacheIndex(directory) {
  const index = new Map();
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.resource')) continue;
      const file = path.join(directory, entry.name);
      const sourceUrl = await readFirstLine(file);
      if (sourceUrl) index.set(normalizedUrl(sourceUrl), file);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return index;
}

async function fetchWithRetry(url, cacheIndex, attempts = 4) {
  const candidates = [url, ...bigCommerceImageFallbackCandidates(url)]
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
  let lastError;
  for (const candidate of candidates) {
    const cachedFile = cacheIndex.get(normalizedUrl(candidate));
    if (cachedFile) {
      const cached = decodeCachedResourceText(await fs.readFile(cachedFile, 'utf8'));
      return {
        buffer: cached.buffer,
        contentType: cached.contentType,
        source: candidate === url ? 'capture-cache' : 'capture-cache-fallback',
      };
    }
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetch(candidate, {
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CocoOfflinePublisher/3.0' },
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error('empty response');
        return {
          buffer,
          contentType: response.headers.get('content-type') || '',
          source: candidate === url ? 'network' : 'network-fallback',
        };
      } catch (error) {
        lastError = error;
        if (error?.status === 404) break;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  throw new Error(`unable to freeze ${url}: ${lastError}`);
}

async function mapConcurrent(items, limit, worker) {
  let index = 0;
  const results = new Array(items.length);
  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return results;
}

const allHtmlFiles = await listHtmlFiles(replayRoot);
const routeFiles = new Set();
for (const manifestName of ['routes.json', 'routes-mobile.json']) {
  try {
    const routeMap = JSON.parse(await fs.readFile(path.join(replayRoot, manifestName), 'utf8'));
    for (const filename of Object.values(routeMap)) routeFiles.add(String(filename));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
const htmlFiles = [...routeFiles].sort().map((filename) => path.join(replayRoot, filename));
const orphanHtmlFiles = allHtmlFiles.filter((file) => !routeFiles.has(path.basename(file)));
for (const file of htmlFiles) await fs.access(file);
const originalHtml = new Map();
const mediaReferences = new Map();
for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  originalHtml.set(file, html);
  for (const reference of collectExternalMediaReferences(html)) {
    mediaReferences.set(reference.url, reference.required || mediaReferences.get(reference.url) === true);
  }
}

await fs.mkdir(outputRoot, { recursive: true });
for (const entry of await fs.readdir(outputRoot, { withFileTypes: true })) {
  await fs.rm(path.join(outputRoot, entry.name), {
    recursive: entry.isDirectory(),
    force: true,
    maxRetries: 8,
    retryDelay: 125,
  });
}
const cacheIndex = await buildCacheIndex(cacheRoot);
const resourceMap = new Map();
const skippedOptional = [];
const frozenResults = await mapConcurrent([...mediaReferences].sort(([left], [right]) => left.localeCompare(right)), 4, async ([url, required]) => {
  if (!required && !cacheIndex.has(normalizedUrl(url))) {
    const reason = 'optional media has a verified local fallback and is absent from the capture cache';
    skippedOptional.push({ url, error: reason });
    process.stdout.write(`SKIPPED_OPTIONAL ${url} ${reason}\n`);
    return null;
  }
  let downloaded;
  try {
    downloaded = await fetchWithRetry(url, cacheIndex);
  } catch (error) {
    if (required) throw error;
    skippedOptional.push({ url, error: String(error) });
    process.stdout.write(`SKIPPED_OPTIONAL ${url} ${error}\n`);
    return null;
  }
  const filename = `${createHash('sha256').update(url).digest('hex').slice(0, 32)}${extensionFor(url, downloaded.contentType)}`;
  await writeFileWithRetry(path.join(outputRoot, filename), downloaded.buffer);
  const localUrl = `/frozen-assets/external-v3/${filename}`;
  resourceMap.set(url, localUrl);
  process.stdout.write(`FROZEN ${downloaded.source} ${downloaded.buffer.length} ${url} -> ${localUrl}\n`);
  return { url, localUrl, bytes: downloaded.buffer.length, contentType: downloaded.contentType, source: downloaded.source };
});
const frozen = frozenResults.filter(Boolean);

const aggregate = {
  removedIframes: 0,
  removedScripts: 0,
  removedLinks: 0,
  removedLazyAttributes: 0,
  localizedResources: 0,
  localizedNavigation: 0,
  removedCssUrls: 0,
  removedExternalResourceAttributes: 0,
  staticVideoFallbacks: 0,
};
for (const [file, html] of originalHtml) {
  const result = sanitizePublishedHtml(html, { resourceMap, sourceHosts, navigationFallbacks });
  for (const key of Object.keys(aggregate)) aggregate[key] += result.report[key] || 0;
  await writeFileWithRetry(file, result.html, 'utf8');
}
for (const file of orphanHtmlFiles) await fs.rm(file);

const failures = [];
for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  const audit = auditPublishedSiteHtml(html, { sourceHosts });
  if (!audit.pass) failures.push({ file: path.basename(file), failures: audit.failures });
}
if (failures.length) throw new Error(`clean publish gate failed: ${JSON.stringify(failures.slice(0, 20))}`);

const report = {
  generatedAt: new Date().toISOString(),
  siteRoot,
  htmlFiles: htmlFiles.length,
  orphanReplayFilesRemoved: orphanHtmlFiles.length,
  externalMediaFrozen: frozen.length,
  frozen,
  optionalCssMediaRemoved: skippedOptional.length,
  skippedOptional,
  aggregate,
  pass: true,
};
await writeFileWithRetry(path.join(outputRoot, 'clean-publish-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

