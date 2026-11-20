import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadRemoteAssetWithCurl } from './remote-font-freezer.mjs';
import { recoverResource } from './resource-recovery.mjs';

function canonicalStorefrontHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function assertPdf(buffer, url) {
  if (!buffer?.length || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`Invalid PDF response for ${url}`);
  }
}

function documentTargetsIn(html, sourceOrigin) {
  const sourceUrl = new URL(sourceOrigin);
  const sourceHost = canonicalStorefrontHost(sourceUrl.hostname);
  const targets = new Map();
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+\.pdf(?:[?#][^"']*)?)\1/gi)) {
    let target;
    try { target = new URL(match[2].replaceAll('&amp;', '&'), sourceUrl.origin); } catch { continue; }
    if (!/^https?:$/.test(target.protocol) || canonicalStorefrontHost(target.hostname) !== sourceHost) continue;
    const route = target.pathname;
    if (!route.startsWith('/') || route.split('/').includes('..')) continue;
    targets.set(route, target.href);
  }
  return targets;
}

async function freezeDocumentTargets(targets, {
  cacheDir,
  fetchImpl = globalThis.fetch,
  fallbackDownloadImpl = downloadRemoteAssetWithCurl,
} = {}) {
  if (!cacheDir) throw new Error('cacheDir is required');
  if (!targets.size) return [];
  await fs.mkdir(cacheDir, { recursive: true });
  const documents = [];
  for (const [route, url] of targets) {
    const recovered = await recoverResource({
      primaryUrl: url,
      declaredCandidates: [],
      cacheDir,
      maxAttemptsPerCandidate: 3,
      fetchResource: async (sourceUrl, { attempt }) => {
        try {
          const response = await fetchImpl(sourceUrl);
          if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
          return Buffer.from(await response.arrayBuffer());
        } catch (fetchError) {
          if (attempt < 3 || !fallbackDownloadImpl) throw fetchError;
          try {
            return Buffer.from(await fallbackDownloadImpl(sourceUrl, { partialPath: path.join(cacheDir, 'document.partial') }));
          } catch (fallbackError) {
            throw new Error(`${fetchError?.message || 'fetch failed'}; fallback failed: ${fallbackError?.message || fallbackError}`);
          }
        }
      },
      validateResource(buffer, sourceUrl) {
        assertPdf(buffer, sourceUrl);
        return true;
      },
    });
    if (!recovered.pass) {
      const error = new Error(`Unable to freeze document ${url}: ${recovered.failure?.message || 'download failed'}`);
      error.recovery = { kind: 'resource', resourceUrl: url, attempts: recovered.attempts };
      throw error;
    }
    const buffer = await fs.readFile(recovered.cachePath);
    documents.push({ route, url, cachePath: recovered.cachePath, byteLength: buffer.length });
  }
  return documents;
}

export async function freezeRemoteDocumentLinks(html, {
  sourceOrigin,
  cacheDir,
  fetchImpl = globalThis.fetch,
  fallbackDownloadImpl = downloadRemoteAssetWithCurl,
} = {}) {
  if (!sourceOrigin) throw new Error('sourceOrigin is required');
  const source = String(html || '');
  const documents = await freezeDocumentTargets(documentTargetsIn(source, sourceOrigin), { cacheDir, fetchImpl, fallbackDownloadImpl });
  return { html: source, documents };
}

export async function publishFrozenDocuments(documents, { outputDir } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const root = path.resolve(outputDir);
  const routes = [];
  for (const document of documents || []) {
    const route = String(document.route || '');
    const targetPath = path.resolve(root, `.${route}`);
    if (!route.startsWith('/') || !targetPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Unsafe document route: ${route}`);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(document.cachePath, targetPath);
    routes.push(route);
  }
  return [...new Set(routes)].sort();
}

export async function preflightRemoteDocuments(htmlSources, options = {}) {
  const groupedSources = new Map();
  for await (const html of htmlSources || []) {
    const source = String(html || '');
    const sourceBase = source.match(/<base\b[^>]*href=["']([^"']+)/i)?.[1];
    if (!sourceBase) continue;
    let sourceUrl;
    try { sourceUrl = new URL(sourceBase); } catch { continue; }
    const key = `${sourceUrl.protocol}//${canonicalStorefrontHost(sourceUrl.hostname)}`;
    const group = groupedSources.get(key) || { sourceOrigin: sourceUrl.origin, targets: new Map() };
    for (const [route, url] of documentTargetsIn(source, group.sourceOrigin)) {
      if (!group.targets.has(route)) group.targets.set(route, url);
    }
    groupedSources.set(key, group);
  }
  const documentsByRoute = new Map();
  const failures = [];
  for (const group of groupedSources.values()) {
    for (const [route, url] of [...group.targets].sort(([left], [right]) => left.localeCompare(right))) {
      try {
        const documents = await freezeDocumentTargets(new Map([[route, url]]), options);
        for (const document of documents) documentsByRoute.set(document.route, document);
      } catch (error) {
        failures.push({ route, url, error: error?.message || String(error), recovery: error?.recovery || null });
      }
    }
  }
  return {
    documents: [...documentsByRoute.values()].sort((a, b) => a.route.localeCompare(b.route)),
    failures,
  };
}
