import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { assertExpectedContent, fetchBinaryWithChrome } from './lib/browser-binary-fetch.mjs';
import { routeFilename } from './lib/site-inventory.mjs';
import {
  composeRecoveryAssetMap,
  createStylesheetRecoveryPlan,
  extractExternalStylesheets,
  isRecentProtectedResource,
  mergeRecoveryLedger,
  recoveryStatusForPage,
  shouldQueueRecoveryPage,
} from './lib/stylesheet-recovery.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const goldenRoot = path.join(root, 'artifacts', 'full-site-audit', 'golden');
const recoveryRoot = path.join(root, 'artifacts', 'full-site-audit', 'recovery', 'stylesheets');
const cacheRoot = path.join(recoveryRoot, 'cache');
const profileRoot = path.join(root, 'artifacts', 'browser-profiles');
const ledgerPath = path.join(recoveryRoot, 'recovery-ledger.json');
const browserPath = process.env.MATBOX_CHROMIUM_PATH;
const execFileAsync = promisify(execFile);

function argument(name) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
}

function slug(route) {
  return routeFilename(route).replace(/^route-|\.html$/g, '');
}

function resourceFilename(url) {
  return `${crypto.createHash('sha256').update(url).digest('hex')}.css`;
}

function isSourceProtection(error) {
  return /text\/html|verification challenge|verify (?:that )?you are human|checking your browser|just a moment|Browser fetch failed: (?:401|403|429)/i.test(String(error?.message || error || ''));
}

async function runNode(args) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function sourceUrlForRoute(route, viewport) {
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(goldenRoot, `${slug(route)}-${viewport}.json`), 'utf8'));
    return metadata.sourceUrl || metadata.metadata?.sourceUrl || null;
  } catch {
    return null;
  }
}

await fs.mkdir(cacheRoot, { recursive: true });
await fs.mkdir(profileRoot, { recursive: true });
const routeFilter = argument('route');
const sourceHtmlFileOverride = argument('source-html-file');
const verifiedAssetMapFile = argument('verified-asset-map');
if (sourceHtmlFileOverride && !routeFilter) throw new Error('--source-html-file requires one --route');
const viewportFilter = argument('viewport') || (sourceHtmlFileOverride ? 'desktop' : null);
if (viewportFilter && !['desktop', 'mobile'].includes(viewportFilter)) throw new Error('--viewport must be desktop or mobile');
const maxPages = Math.max(1, Number.parseInt(argument('max-pages') || '999999', 10) || 999999);
const execute = process.argv.includes('--execute');
const retryProtected = process.argv.includes('--retry-protected');
let verifiedAssetMap = {};
if (verifiedAssetMapFile) {
  const verifiedMapPath = path.resolve(root, verifiedAssetMapFile);
  const relativeMapPath = path.relative(root, verifiedMapPath);
  if (relativeMapPath.startsWith('..') || path.isAbsolute(relativeMapPath)) {
    throw new Error('--verified-asset-map must stay inside the project root');
  }
  const parsed = JSON.parse(await fs.readFile(verifiedMapPath, 'utf8'));
  for (const [url, entry] of Object.entries(parsed || {})) {
    if (!/^https?:\/\//i.test(url) || !entry?.file || !entry?.mime) {
      throw new Error(`Invalid verified asset entry: ${url}`);
    }
    const assetPath = path.resolve(root, entry.file);
    const relativeAssetPath = path.relative(root, assetPath);
    if (relativeAssetPath.startsWith('..') || path.isAbsolute(relativeAssetPath)) {
      throw new Error(`Verified asset must stay inside the project root: ${url}`);
    }
    const buffer = await fs.readFile(assetPath);
    if (!buffer.length) throw new Error(`Verified asset is empty: ${url}`);
    assertExpectedContent(buffer, entry.mime, entry.mime);
    verifiedAssetMap[url] = {
      file: relativeAssetPath.replace(/\\/g, '/'),
      mime: entry.mime,
    };
  }
}
let previousLedger = { resources: {}, pages: [] };
try { previousLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); } catch {}
const pageKey = (page) => `${page.viewport || 'desktop'}:${page.route}`;
const previousPageByRoute = new Map((previousLedger.pages || []).map((page) => [pageKey(page), page]));
const routeManifests = [];
for (const [viewport, filename] of [['desktop', 'routes.json'], ['mobile', 'routes-mobile.json']]) {
  if (viewportFilter && viewport !== viewportFilter) continue;
  try {
    routeManifests.push({ viewport, routes: JSON.parse(await fs.readFile(path.join(replayRoot, filename), 'utf8')) });
  } catch {}
}
let candidateFiles = null;
if (!sourceHtmlFileOverride) {
  try {
    const pattern = String.raw`<link(?=[^>]*rel=["'][^"']*stylesheet)(?=[^>]*href=["'](?!data:|blob:))`;
    const { stdout } = await execFileAsync('rg', ['-l', '-P', '-g', '*.html', pattern, replayRoot], { maxBuffer: 4 * 1024 * 1024 });
    candidateFiles = new Set(String(stdout).split(/\r?\n/).filter(Boolean).map((file) => path.basename(file)));
  } catch (error) {
    if (error?.code !== 1) process.stderr.write(`STYLESHEET_INDEX_FALLBACK ${error?.message || error}\n`);
  }
}
const pages = [];
pageScan:
for (const { viewport, routes } of routeManifests) {
  for (const [route, filename] of Object.entries(routes)) {
    if (routeFilter && route !== routeFilter) continue;
    if (!shouldQueueRecoveryPage(previousPageByRoute.get(`${viewport}:${route}`)?.status, {
      routeFilter: Boolean(routeFilter),
      retryProtected,
      verifiedAssetMap: Boolean(verifiedAssetMapFile),
    })) continue;
    if (candidateFiles && !candidateFiles.has(filename)) continue;
    const htmlPath = sourceHtmlFileOverride
      ? path.resolve(root, sourceHtmlFileOverride)
      : path.join(replayRoot, filename);
    const relativeHtmlPath = path.relative(root, htmlPath);
    if (relativeHtmlPath.startsWith('..') || path.isAbsolute(relativeHtmlPath)) throw new Error('--source-html-file must stay inside the project root');
    let html;
    try { html = await fs.readFile(htmlPath, 'utf8'); } catch { continue; }
    if (!/<link\b[^>]*\brel=["'][^"']*stylesheet/i.test(html)) continue;
    const sourceUrl = await sourceUrlForRoute(route, viewport);
    if (!sourceUrl) continue;
    const stylesheets = extractExternalStylesheets(html, sourceUrl);
    if (!stylesheets.length) continue;
    pages.push({ route, viewport, filename, htmlPath, sourceUrl, stylesheets });
    if (pages.length >= maxPages) break pageScan;
  }
}

const plan = createStylesheetRecoveryPlan(pages);
if (!execute) {
  process.stdout.write(`${JSON.stringify({ execute: false, pageCount: plan.pages.length, resourceCount: plan.resources.length, pages: plan.pages }, null, 2)}\n`);
  process.exit(0);
}

const resourceStatusByUrl = new Map();
for (let index = 0; index < plan.resources.length; index += 1) {
  const resource = plan.resources[index];
  const filename = resourceFilename(resource.url);
  const outputPath = path.join(cacheRoot, filename);
  const profileDir = path.join(profileRoot, `stylesheet-recovery-${process.pid}-${index}`);
  const previousResource = previousLedger.resources?.[resource.url];
  const verifiedOverride = verifiedAssetMap[resource.url];
  if (verifiedOverride) {
    const verifiedBuffer = await fs.readFile(path.resolve(root, verifiedOverride.file));
    assertExpectedContent(verifiedBuffer, verifiedOverride.mime, 'text/css');
    resourceStatusByUrl.set(resource.url, {
      status: 'recovered',
      file: verifiedOverride.file,
      byteLength: verifiedBuffer.length,
      contentType: 'text/css',
      verifiedOverride: true,
      checkedAt: new Date().toISOString(),
      routes: resource.routes,
    });
    process.stdout.write(`${index + 1}/${plan.resources.length} STYLESHEET_VERIFIED_OVERRIDE ${resource.url}\n`);
    continue;
  }
  if (!retryProtected && isRecentProtectedResource(previousResource)) {
    resourceStatusByUrl.set(resource.url, { ...previousResource, routes: resource.routes });
    process.stdout.write(`${index + 1}/${plan.resources.length} STYLESHEET_PROTECTION_CACHE ${resource.url}\n`);
    continue;
  }
  try {
    try {
      const cached = await fs.readFile(outputPath);
      assertExpectedContent(cached, 'text/css', 'text/css');
      resourceStatusByUrl.set(resource.url, {
        status: 'recovered',
        file: path.relative(root, outputPath).replace(/\\/g, '/'),
        byteLength: cached.length,
        contentType: 'text/css',
        cached: true,
        checkedAt: new Date().toISOString(),
        routes: resource.routes,
      });
      process.stdout.write(`${index + 1}/${plan.resources.length} STYLESHEET_CACHE ${resource.url}\n`);
      continue;
    } catch {}
    let result;
    try {
      result = await fetchBinaryWithChrome(resource.url, {
        browserPath,
        profileDir,
        expectedContentType: 'text/css',
      });
    } catch (error) {
      if (!isSourceProtection(error)) throw error;
      result = await fetchBinaryWithChrome(resource.url, {
        browserPath,
        profileDir: `${profileDir}-context`,
        expectedContentType: 'text/css',
        contextUrl: new URL('/robots.txt', resource.url).href,
      });
    }
    await fs.writeFile(outputPath, result.buffer);
    resourceStatusByUrl.set(resource.url, {
      status: 'recovered',
      file: path.relative(root, outputPath).replace(/\\/g, '/'),
      byteLength: result.buffer.length,
      contentType: result.mimeType,
      responseUrl: result.responseUrl,
      checkedAt: new Date().toISOString(),
      routes: resource.routes,
    });
    process.stdout.write(`${index + 1}/${plan.resources.length} STYLESHEET_RECOVERED ${resource.url}\n`);
  } catch (error) {
    const status = isSourceProtection(error) ? 'source-protected' : 'failed';
    resourceStatusByUrl.set(resource.url, {
      status,
      error: String(error?.message || error),
      checkedAt: new Date().toISOString(),
      routes: resource.routes,
    });
    process.stdout.write(`${index + 1}/${plan.resources.length} STYLESHEET_${status.toUpperCase().replace('-', '_')} ${resource.url}\n`);
  }
}

const pageResults = [];
for (const page of plan.pages) {
  const readiness = recoveryStatusForPage(page, resourceStatusByUrl);
  if (readiness.status !== 'ready') {
    pageResults.push({ route: page.route, viewport: page.viewport, status: readiness.status, unresolved: readiness.unresolved });
    continue;
  }
  const pageSlug = slug(page.route);
  const mapPath = path.join(recoveryRoot, pageSlug, `asset-map-${page.viewport}.json`);
  await fs.mkdir(path.dirname(mapPath), { recursive: true });
  const assetMap = composeRecoveryAssetMap(page, resourceStatusByUrl, verifiedAssetMap);
  await fs.writeFile(mapPath, `${JSON.stringify(assetMap, null, 2)}\n`);
  const result = await runNode([
    path.join('scripts', 'capture-rendered-golden.mjs'),
    '--http-seed',
    `--viewport=${page.viewport}`,
    `--route=${page.route}`,
    `--source-url=${page.sourceUrl}`,
    `--source-html-file=${path.relative(root, page.htmlPath)}`,
    `--source-asset-map=${path.relative(root, mapPath)}`,
  ]);
  if (result.code === 0) {
    pageResults.push({ route: page.route, viewport: page.viewport, status: 'recovered-and-validated' });
    process.stdout.write(`PAGE_RECOVERED ${page.viewport} ${page.route}\n`);
  } else {
    const error = (result.stderr || result.stdout).trim().split(/\r?\n/).find((line) => /Error:/.test(line)) || 'capture validation failed';
    pageResults.push({ route: page.route, viewport: page.viewport, status: 'validation-failed', error });
    process.stdout.write(`PAGE_VALIDATION_FAILED ${page.viewport} ${page.route} ${error}\n`);
  }
}

const currentLedger = {
  resources: Object.fromEntries(resourceStatusByUrl),
  pages: pageResults,
};
const mergedLedger = mergeRecoveryLedger(previousLedger, currentLedger);
const ledger = {
  generatedAt: new Date().toISOString(),
  pageCount: mergedLedger.pages.length,
  resourceCount: Object.keys(mergedLedger.resources).length,
  resources: mergedLedger.resources,
  pages: mergedLedger.pages,
};
await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  ledger: path.relative(root, ledgerPath).replace(/\\/g, '/'),
  counts: Object.fromEntries([...new Set(ledger.pages.map((page) => page.status))].sort().map((status) => [status, ledger.pages.filter((page) => page.status === status).length])),
}, null, 2)}\n`);
