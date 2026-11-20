import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freezeRemoteDocumentLinks, preflightRemoteDocuments, publishFrozenDocuments } from '../scripts/lib/remote-document-freezer.mjs';

test('same-storefront PDF links are downloaded once and registered at their original local route', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-documents-'));
  let downloads = 0;
  const html = '<a href="https://www.cocorepublic.com.au/content/report.pdf">Download report</a>';
  const options = {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    cacheDir,
    fetchImpl: async () => {
      downloads += 1;
      return { ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.7\nreport') };
    },
  };

  const first = await freezeRemoteDocumentLinks(html, options);
  const second = await freezeRemoteDocumentLinks(html, options);

  assert.equal(downloads, 1);
  assert.equal(first.html, html);
  assert.equal(first.documents.length, 1);
  assert.equal(first.documents[0].route, '/content/report.pdf');
  assert.equal(await fs.readFile(first.documents[0].cachePath, 'utf8'), '%PDF-1.7\nreport');
  assert.deepEqual(second.documents.map(({ route, byteLength }) => ({ route, byteLength })), [
    { route: '/content/report.pdf', byteLength: Buffer.byteLength('%PDF-1.7\nreport') },
  ]);
});

test('external PDFs and non-document links are not imported as storefront documents', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-documents-external-'));
  const result = await freezeRemoteDocumentLinks([
    '<a href="https://example.com/report.pdf">External report</a>',
    '<a href="https://www.cocorepublic.com.au/sofas">Sofas</a>',
  ].join(''), {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    cacheDir,
    fetchImpl: async () => { throw new Error('must not download'); },
  });

  assert.deepEqual(result.documents, []);
});

test('frozen documents are published at the exact local route used by the page link', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-document-cache-'));
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-document-output-'));
  const cachePath = path.join(cacheDir, 'report.pdf');
  await fs.writeFile(cachePath, '%PDF-1.7\npublished');

  const routes = await publishFrozenDocuments([
    { route: '/content/report.pdf', cachePath },
  ], { outputDir });

  assert.deepEqual(routes, ['/content/report.pdf']);
  assert.equal(await fs.readFile(path.join(outputDir, 'content', 'report.pdf'), 'utf8'), '%PDF-1.7\npublished');
});

test('document preflight derives each page source origin and deduplicates shared documents before assembly', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-document-preflight-'));
  let downloads = 0;
  const result = await preflightRemoteDocuments([
    '<base href="https://www.cocorepublic.com.au/"><a href="/content/report.pdf">Report</a>',
    '<base href="https://www.cocorepublic.com.au/page"><a href="https://cocorepublic.com.au/content/report.pdf">Same report</a>',
  ], {
    cacheDir,
    fetchImpl: async () => {
      downloads += 1;
      return { ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.7\npreflight') };
    },
  });

  assert.equal(downloads, 1);
  assert.deepEqual(result.documents.map(({ route }) => route), ['/content/report.pdf']);
});

test('document download uses the verified fallback channel after direct network access is denied', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-document-fallback-'));
  let fetchAttempts = 0;
  let fallbackAttempts = 0;
  const result = await freezeRemoteDocumentLinks(
    '<a href="https://www.cocorepublic.com.au/content/report.pdf">Report</a>',
    {
      sourceOrigin: 'https://www.cocorepublic.com.au',
      cacheDir,
      fetchImpl: async () => {
        fetchAttempts += 1;
        throw Object.assign(new Error('connect EACCES'), { code: 'EACCES' });
      },
      fallbackDownloadImpl: async (url, { partialPath }) => {
        fallbackAttempts += 1;
        assert.equal(url, 'https://www.cocorepublic.com.au/content/report.pdf');
        assert.match(partialPath, /\.partial$/);
        return Buffer.from('%PDF-1.7\nfallback');
      },
    },
  );

  assert.equal(fetchAttempts, 3);
  assert.equal(fallbackAttempts, 1);
  assert.equal(result.documents[0].byteLength, Buffer.byteLength('%PDF-1.7\nfallback'));
});

test('document preflight records an unavailable page document without aborting other documents', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-document-partial-'));
  const result = await preflightRemoteDocuments([
    [
      '<base href="https://www.cocorepublic.com.au/">',
      '<a href="/content/unavailable.pdf">Unavailable</a>',
      '<a href="/content/available.pdf">Available</a>',
    ].join(''),
  ], {
    cacheDir,
    fetchImpl: async (url) => {
      if (url.endsWith('/available.pdf')) {
        return { ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.7\navailable') };
      }
      throw new Error('source timeout');
    },
    fallbackDownloadImpl: null,
  });

  assert.deepEqual(result.documents.map(({ route }) => route), ['/content/available.pdf']);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].route, '/content/unavailable.pdf');
  assert.match(result.failures[0].error, /Unable to freeze document .*source timeout/);
  assert.equal(result.failures[0].recovery.kind, 'resource');
  assert.equal(result.failures[0].recovery.resourceUrl, 'https://www.cocorepublic.com.au/content/unavailable.pdf');
  assert.equal(result.failures[0].recovery.attempts.length, 3);
});
