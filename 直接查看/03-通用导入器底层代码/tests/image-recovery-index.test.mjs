import test from 'node:test';
import assert from 'node:assert/strict';

import {
  imageSourceIdentity,
  selectReusableImageCandidate,
} from '../scripts/lib/image-recovery-index.mjs';

test('BigCommerce product image identity ignores stencil size and cache query only', () => {
  const left = 'https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/27/208/chair.jpg?t=1';
  const right = 'https://cdn11.bigcommerce.com/s-store/images/stencil/original/products/27/208/chair.jpg?t=2';
  assert.equal(imageSourceIdentity(left), imageSourceIdentity(right));
  assert.notEqual(
    imageSourceIdentity(left),
    imageSourceIdentity('https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/27/209/chair.jpg?t=1'),
  );
});

test('ordinary image identity preserves host and path while dropping cache query', () => {
  assert.equal(
    imageSourceIdentity('https://www.example.com/images/banner.jpg?v=2'),
    'https://www.example.com/images/banner.jpg',
  );
  assert.notEqual(
    imageSourceIdentity('https://a.example.com/images/banner.jpg'),
    imageSourceIdentity('https://b.example.com/images/banner.jpg'),
  );
});

test('recovery selects a real frozen source and rejects screenshot-derived or empty candidates', () => {
  const target = 'https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/27/208/chair.jpg';
  const selected = selectReusableImageCandidate(target, [
    { originalSource: target, currentSource: 'data:image/png;base64,SCREEN', intrinsicWidth: 800, intrinsicHeight: 600, screenshotDerived: true },
    { originalSource: target, currentSource: 'data:image/png;base64,EMPTY', intrinsicWidth: 0, intrinsicHeight: 0, screenshotDerived: false },
    { originalSource: target.replace('/768w/', '/original/'), currentSource: 'data:image/jpeg;base64,REAL', intrinsicWidth: 1600, intrinsicHeight: 1200, screenshotDerived: false },
  ]);
  assert.equal(selected.currentSource, 'data:image/jpeg;base64,REAL');
  assert.equal(selectReusableImageCandidate(target, [
    { originalSource: target, currentSource: 'data:image/png;base64,SCREEN', intrinsicWidth: 800, intrinsicHeight: 600, screenshotDerived: true },
  ]), null);
});
