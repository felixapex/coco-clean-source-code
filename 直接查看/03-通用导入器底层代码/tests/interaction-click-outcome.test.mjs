import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPostClickNavigation,
  isExpectedNoChange,
} from '../scripts/lib/interaction-click-outcome.mjs';

const localOrigin = 'http://127.0.0.1:4173';
const generatedRoutes = new Set([
  '/-archer-deep-sofa.html',
  '/fabric-swatches/fabric-swatches-for-archer',
  '/search.php',
]);

test('click audit accepts a button navigation only when it reaches a generated local route', () => {
  assert.deepEqual(classifyPostClickNavigation({
    beforeUrl: `${localOrigin}/-archer-deep-sofa.html`,
    afterUrl: `${localOrigin}/fabric-swatches/fabric-swatches-for-archer/`,
    localOrigin,
    generatedRoutes,
  }), {
    kind: 'local-navigation',
    target: '/fabric-swatches/fabric-swatches-for-archer',
    pathname: '/fabric-swatches/fabric-swatches-for-archer',
  });
});

test('click audit does not excuse a replaced target when the URL did not change', () => {
  assert.deepEqual(classifyPostClickNavigation({
    beforeUrl: `${localOrigin}/search.php?search_query=aster`,
    afterUrl: `${localOrigin}/search.php?search_query=aster`,
    localOrigin,
    generatedRoutes,
  }), { kind: 'unchanged' });
});

test('click audit rejects navigation back to a captured source origin', () => {
  assert.deepEqual(classifyPostClickNavigation({
    beforeUrl: `${localOrigin}/-archer-deep-sofa.html`,
    afterUrl: 'https://www.cocorepublic.com.au/fabric-swatches/fabric-swatches-for-archer/',
    localOrigin,
    generatedRoutes,
    sourceOrigins: new Set(['https://www.cocorepublic.com.au']),
  }), {
    kind: 'failure',
    type: 'source-domain-escape',
    target: 'https://www.cocorepublic.com.au/fabric-swatches/fabric-swatches-for-archer/',
  });
});

test('already selected swatch is an expected no-change interaction using observed pre-click state', () => {
  assert.equal(isExpectedNoChange({
    control: { className: 'product-card-swatch-button', ariaPressed: null, tag: 'button', type: '' },
    outcome: { before: { pressed: 'true' } },
  }), true);
});
