import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const IMPORT_PATTERN = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;?/gi;
const URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isRemoteReference(value) {
  return value && !/^(?:data:|blob:|about:|#|javascript:)/i.test(value);
}

function absoluteUrl(value, baseUrl) {
  const resolved = new URL(String(value).replaceAll('&amp;', '&'), baseUrl);
  if (!['http:', 'https:'].includes(resolved.protocol)) throw new Error(`Unsupported resource protocol: ${resolved.protocol}`);
  return resolved.href;
}

function extensionFor(url, contentType = '') {
  const pathname = new URL(url).pathname;
  const extension = path.posix.extname(pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/i.test(extension)) return extension;
  const normalized = String(contentType).split(';')[0].trim().toLowerCase();
  return ({
    'text/css': '.css',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'font/woff2': '.woff2',
    'font/woff': '.woff',
    'font/ttf': '.ttf',
    'font/otf': '.otf',
  })[normalized] ?? '.bin';
}

function kindForCssUrl(url) {
  return /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url) ? 'font' : 'background-image';
}

function localPathFor(url, contentType = '') {
  return `assets/${sha256(url).slice(0, 24)}${extensionFor(url, contentType)}`;
}

function referencesInDocument(document, baseUrl) {
  const sourceUrl = document.sourceUrl || baseUrl;
  const found = [];
  const content = String(document.content || '');
  for (const match of content.matchAll(/<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi)) {
    const href = match[0].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (isRemoteReference(href)) found.push({ raw: href, url: absoluteUrl(href, sourceUrl), kind: 'stylesheet' });
  }
  for (const match of content.matchAll(/<(?:img|image|video|source)\b[^>]*\b(?:src|poster)\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    const value = match[2];
    if (isRemoteReference(value)) found.push({ raw: value, url: absoluteUrl(value, sourceUrl), kind: 'image' });
  }
  for (const match of content.matchAll(URL_PATTERN)) {
    const value = match[2].trim();
    if (isRemoteReference(value)) found.push({ raw: value, url: absoluteUrl(value, sourceUrl), kind: kindForCssUrl(value) });
  }
  return found;
}

function cssReferences(content, sourceUrl) {
  const imports = [];
  for (const match of String(content).matchAll(IMPORT_PATTERN)) {
    const value = match[1].trim();
    if (isRemoteReference(value)) imports.push({ raw: value, url: absoluteUrl(value, sourceUrl), kind: 'style-import' });
  }
  const importUrls = new Set(imports.map((entry) => entry.url));
  const assets = [];
  for (const match of String(content).matchAll(URL_PATTERN)) {
    const value = match[2].trim();
    if (!isRemoteReference(value)) continue;
    const url = absoluteUrl(value, sourceUrl);
    if (!importUrls.has(url)) assets.push({ raw: value, url, kind: kindForCssUrl(value) });
  }
  return [...imports, ...assets];
}

function replaceAllLiteral(content, raw, replacement) {
  return String(content).split(raw).join(replacement);
}

export async function freezeResourceGraph(input = {}, options = {}) {
  const baseUrl = absoluteUrl(input.baseUrl, input.baseUrl);
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const outputDir = path.resolve(options.outputDir || '');
  if (!options.outputDir) throw new TypeError('outputDir is required');
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  await mkdir(path.join(outputDir, 'assets'), { recursive: true });

  const resources = new Map();
  const unresolved = new Set();

  async function visit(reference, referencedBy, ancestry = new Set()) {
    const existing = resources.get(reference.url);
    if (existing) {
      if (!existing.referencedBy.includes(referencedBy)) existing.referencedBy.push(referencedBy);
      if (existing.pending && !ancestry.has(reference.url)) await existing.pending;
      return existing;
    }

    const resource = {
      id: `resource:${sha256(reference.url).slice(0, 20)}`,
      kind: reference.kind,
      sourceUrl: reference.url,
      localPath: localPathFor(reference.url),
      sha256: '',
      byteLength: 0,
      status: 'pending',
      critical: true,
      referencedBy: [referencedBy],
    };
    resources.set(reference.url, resource);
    resource.pending = (async () => {
      try {
        const response = await options.fetchImpl(reference.url);
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
        const contentType = response.headers?.get?.('content-type') || '';
        let buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error('empty response body');
        resource.localPath = localPathFor(reference.url, contentType);

        const stylesheet = ['stylesheet', 'style-import'].includes(reference.kind)
          || /^text\/css/i.test(contentType)
          || /\.(?:css|wxss)(?:[?#]|$)/i.test(reference.url);
        if (stylesheet) {
          let text = buffer.toString('utf8');
          const dependencies = cssReferences(text, reference.url);
          const nextAncestry = new Set(ancestry);
          nextAncestry.add(reference.url);
          for (const dependency of dependencies) {
            const child = await visit(dependency, resource.id, nextAncestry);
            if (child.status !== 'failed') {
              text = replaceAllLiteral(text, dependency.raw, `./${path.posix.basename(child.localPath)}`);
            }
          }
          buffer = Buffer.from(text, 'utf8');
        }

        await writeFile(path.join(outputDir, resource.localPath), buffer);
        resource.sha256 = sha256(buffer);
        resource.byteLength = buffer.length;
        resource.status = 'frozen';
      } catch (error) {
        resource.status = 'failed';
        resource.error = error?.message || String(error);
        unresolved.add(reference.url);
      }
    })();
    await resource.pending;
    delete resource.pending;
    return resource;
  }

  const rewrittenDocuments = [];
  for (const document of documents) {
    let content = String(document.content || '');
    const references = referencesInDocument(document, baseUrl);
    for (const reference of references) {
      const resource = await visit(reference, `document:${document.id ?? 'unknown'}`);
      if (resource.status === 'frozen') content = replaceAllLiteral(content, reference.raw, `./${resource.localPath}`);
    }
    rewrittenDocuments.push({ ...document, content });
  }

  const manifestResources = [...resources.values()]
    .map(({ error, ...resource }) => error ? { ...resource, error } : resource)
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  const unresolvedReferences = [...unresolved].sort();
  return {
    documents: rewrittenDocuments,
    manifest: {
      schemaVersion: 1,
      baseUrl,
      discoveryComplete: true,
      rewritesComplete: unresolvedReferences.length === 0,
      unresolvedReferences,
      resources: manifestResources,
    },
  };
}

