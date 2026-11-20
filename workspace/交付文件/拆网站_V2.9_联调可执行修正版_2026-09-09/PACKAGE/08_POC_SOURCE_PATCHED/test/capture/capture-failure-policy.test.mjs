import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptureValidationDetails,
  classifyCapturePipelineFailure,
  createInvalidCaptureError,
} from '../../src/capture/capture-failure-policy.mjs';

test('shared failure policy classifies network, shared resources, and page defects', () => {
  assert.equal(classifyCapturePipelineFailure('CDP command timeout: Runtime.evaluate').kind, 'infrastructure');
  assert.equal(classifyCapturePipelineFailure('Navigation failed: net::ERR_CONNECTION_RESET').kind, 'infrastructure');
  const font = classifyCapturePipelineFailure('Invalid source capture: uncaptured-fonts details={"uncapturedFonts":[{"url":"https://cdn.test/site.woff2"}]}');
  assert.equal(font.kind, 'shared-resource');
  assert.equal(font.resourceUrl, 'https://cdn.test/site.woff2');
  const stylesheet = classifyCapturePipelineFailure('Invalid source capture: uncaptured-stylesheets details={"uncapturedStylesheets":[{"url":"https://cdn.test/theme.css"}]}');
  assert.equal(stylesheet.kind, 'shared-resource');
  assert.equal(stylesheet.resourceUrl, 'https://cdn.test/theme.css');
  assert.equal(classifyCapturePipelineFailure('Product title missing').kind, 'page');
});

test('shared failure policy serializes complete actionable capture evidence', () => {
  const result = {
    metadata: {
      visualReadiness: {
        viewportWidth: 1440,
        documentWidth: 1425,
        uncapturedFontDetails: [{ url: 'https://cdn.test/site.woff2', errorText: 'font-response-not-captured' }],
        failedNetworkRequestDetails: [{ url: 'https://api.test/search', type: 'XHR', errorText: 'net::ERR_CONNECTION_RESET' }],
      },
    },
  };
  const details = buildCaptureValidationDetails(result);
  assert.deepEqual(details.uncapturedFonts, result.metadata.visualReadiness.uncapturedFontDetails);
  assert.deepEqual(details.failedNetworkRequests, result.metadata.visualReadiness.failedNetworkRequestDetails);
  const error = createInvalidCaptureError({ channel: 'Shopify', route: '/product', failures: ['uncaptured-fonts'], result });
  assert.match(error.message, /Invalid Shopify capture for \/product: uncaptured-fonts/);
  assert.match(error.message, /https:\/\/cdn\.test\/site\.woff2/);
});

test('shared failure policy preserves every structured pending resource URL', () => {
  const failure = classifyCapturePipelineFailure(
    'Invalid source capture: pending-images, pending-background-images details={"pending":[{"src":"https://cdn.test/products/a.jpg"},{"src":"https://cdn.test/menu.jpg"}],"pendingBackgrounds":[{"source":"https://cdn.test/page-hero.jpg"}]}'
  );
  assert.deepEqual(failure.resourceUrls, [
    'https://cdn.test/products/a.jpg',
    'https://cdn.test/menu.jpg',
    'https://cdn.test/page-hero.jpg',
  ]);
});
