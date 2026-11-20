import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldPromoteDeferredImage } from '../../实测/CocoRepublic_2026-10-22/generated-site-v1/scripts/lib/image-readiness-policy.mjs';

test('offline replay never replaces an embedded image with its remote deferred URL', () => {
  assert.equal(shouldPromoteDeferredImage({
    allowNetwork: false,
    currentSource: 'data:image/webp;base64,abc',
    deferredSource: 'https://source.example/image.webp',
    frozen: true,
  }), false);
});

test('online source readiness preserves captured frozen images', () => {
  assert.equal(shouldPromoteDeferredImage({
    allowNetwork: true,
    currentSource: 'data:image/webp;base64,abc',
    deferredSource: 'https://source.example/image.webp',
    frozen: true,
  }), false);
});

test('online source readiness may promote an unfrozen lazy placeholder', () => {
  assert.equal(shouldPromoteDeferredImage({
    allowNetwork: true,
    currentSource: 'data:image/gif;base64,placeholder',
    deferredSource: 'https://source.example/image.webp',
    frozen: false,
  }), true);
});
