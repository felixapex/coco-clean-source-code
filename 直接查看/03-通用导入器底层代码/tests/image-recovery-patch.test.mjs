import test from 'node:test';
import assert from 'node:assert/strict';

import * as imageRecoveryPatch from '../scripts/lib/image-recovery-patch.mjs';

const {
  findActiveRecoveredImageReferences,
  localizeRecoveredImages,
} = imageRecoveryPatch;

test('recovered image patch localizes only the exact failed source and disables remote responsive overrides', () => {
  const sourceUrl = 'https://cdn.test/products/chair.jpg?c=1&amp;x=2';
  const html = `<section><img class="card" src="${sourceUrl}" srcset="https://cdn.test/chair-2x.jpg 2x" data-src="https://cdn.test/lazy.jpg" alt="Chair"><img src="https://cdn.test/other.jpg"></section>`;
  const dataUrl = 'data:image/jpeg;base64,AQID';
  const result = localizeRecoveredImages(html, new Map([[sourceUrl.replaceAll('&amp;', '&'), { dataUrl }]]));
  assert.equal(result.replaced, 1);
  assert.match(result.html, /src="data:image\/jpeg;base64,AQID"/);
  assert.match(result.html, /data-matbox-original-source-url="https:\/\/cdn\.test\/products\/chair\.jpg\?c=1&amp;x=2"/);
  assert.match(result.html, /data-matbox-original-src="https:\/\/cdn\.test\/products\/chair\.jpg\?c=1&amp;x=2"/);
  assert.doesNotMatch(result.html, /\bsrcset=/);
  assert.doesNotMatch(result.html, /\bdata-src=/);
  assert.match(result.html, /<img src="https:\/\/cdn\.test\/other\.jpg">/);
});

test('recovered image patch writes verified intrinsic dimensions into stale capture evidence', () => {
  const source = 'https://cdn.example/recovered.webp';
  const html = `<img src="${source}" data-matbox-image-intrinsic-width="0" data-matbox-image-intrinsic-height="0">`;
  const patched = localizeRecoveredImages(html, new Map([[
    source,
    { dataUrl: 'data:image/webp;base64,AAAA', intrinsicWidth: 800, intrinsicHeight: 600 },
  ]]));

  assert.match(patched.html, /data-matbox-image-intrinsic-width="800"/);
  assert.match(patched.html, /data-matbox-image-intrinsic-height="600"/);
});

test('recovered image patch leaves unrelated markup byte-identical', () => {
  const html = '<section><img src="https://cdn.test/other.jpg"><p>Text</p></section>';
  const result = localizeRecoveredImages(html, new Map([
    ['https://cdn.test/missing.jpg', { dataUrl: 'data:image/png;base64,AQID' }],
  ]));
  assert.equal(result.replaced, 0);
  assert.equal(result.html, html);
});

test('recovered image patch reports repeated replacements per exact source', () => {
  const source = 'https://cdn.test/repeated.jpg';
  const result = localizeRecoveredImages(`<img src="${source}"><div><img src="${source}"></div>`, new Map([
    [source, { dataUrl: 'data:image/jpeg;base64,/9j/' }],
  ]));
  assert.equal(result.replaced, 2);
  assert.equal(result.replacementsBySource[source], 2);
});

test('recovered image patch recognizes an already localized source without rewriting it', () => {
  const source = 'https://cdn.test/already.jpg';
  const html = `<img src="data:image/jpeg;base64,/9j/" data-matbox-original-source-url="${source}">`;
  const result = localizeRecoveredImages(html, new Map([
    [source, { dataUrl: 'data:image/jpeg;base64,/9j/' }],
  ]));

  assert.equal(result.replaced, 0);
  assert.equal(result.alreadyLocalizedBySource[source], 1);
  assert.equal(result.html, html);
});

test('recovered image patch removes a recovered lazy override from an already embedded image', () => {
  const source = 'https://cdn.test/already-inline.webp';
  const html = `<img src="data:image/webp;base64,UklGRg==" data-src="${source}" alt="Chair">`;
  const result = localizeRecoveredImages(html, new Map([
    [source, { dataUrl: 'data:image/webp;base64,UklGRg==' }],
  ]));

  assert.equal(result.replaced, 1);
  assert.match(result.html, /src="data:image\/webp;base64,UklGRg=="/);
  assert.doesNotMatch(result.html, /\bdata-src=/);
  assert.match(result.html, /data-matbox-original-source-url="https:\/\/cdn\.test\/already-inline\.webp"/);
  assert.deepEqual(result.remainingActiveReferences, []);
});

test('source evidence attributes do not count as active external image requests', () => {
  const source = 'https://cdn.test/already.jpg?c=1&x=2';
  const evidenceOnly = `<img src="data:image/jpeg;base64,/9j/" data-matbox-original-source-url="https://cdn.test/already.jpg?c=1&amp;x=2" data-matbox-original-src="https://cdn.test/already.jpg?c=1&amp;x=2">`;
  assert.deepEqual(findActiveRecoveredImageReferences(evidenceOnly, new Set([source])), []);

  const stillActive = `<img src="data:image/jpeg;base64,/9j/" data-src="https://cdn.test/already.jpg?c=1&amp;x=2">`;
  assert.equal(findActiveRecoveredImageReferences(stillActive, new Set([source])).length, 1);
});

test('recovered image localization resolves recoverable sources from src and lazy attributes in the same pass', () => {
  const localizedSource = 'https://cdn.test/localized.jpg';
  const unresolvedSource = 'https://cdn.test/unresolved.jpg';
  const html = [
    `<img src="${localizedSource}" data-src="${localizedSource}">`,
    `<img src="https://cdn.test/placeholder.jpg" data-src="${unresolvedSource}">`,
  ].join('');

  const result = localizeRecoveredImages(html, new Map([
    [localizedSource, { dataUrl: 'data:image/jpeg;base64,/9j/' }],
    [unresolvedSource, { dataUrl: 'data:image/jpeg;base64,AQID' }],
  ]));

  assert.deepEqual(result.remainingActiveReferences, []);
  assert.equal(result.replacementsBySource[localizedSource], 1);
  assert.equal(result.replacementsBySource[unresolvedSource], 1);
  assert.deepEqual(
    result.remainingActiveReferences,
    findActiveRecoveredImageReferences(result.html, new Set([localizedSource, unresolvedSource])),
  );
});

test('cached image recovery decodes the cache envelope instead of treating it as raw image bytes', () => {
  assert.equal(typeof imageRecoveryPatch.decodeCachedImageRecovery, 'function');
  const sourceUrl = 'https://cdn.test/banner.webp';
  const imageBytes = Buffer.from('RIFF-webp-test');
  const cacheEnvelope = `${sourceUrl}\ndata:image/webp;base64,${imageBytes.toString('base64')}`;

  assert.deepEqual(imageRecoveryPatch.decodeCachedImageRecovery(cacheEnvelope, {
    sourceUrl,
    contentType: 'image/webp',
    byteLength: imageBytes.length,
  }), {
    sourceUrl,
    contentType: 'image/webp',
    buffer: imageBytes,
    dataUrl: `data:image/webp;base64,${imageBytes.toString('base64')}`,
  });
});
