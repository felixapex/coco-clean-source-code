import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import {
  afterSettleStateExpression,
  afterTrustedCommerceClickExpression,
  closeDelayedPopupExpression,
  stableStateExpression,
} from './lib/capture-state.mjs';

const result = await capturePage('https://www.cocorepublic.com.au/clearance', {
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  beforeCollectExpression: stableStateExpression,
  beforeCollectTrustedClickSelector: '#searchspring-category .ss-load-more',
  afterTrustedClickExpression: afterTrustedCommerceClickExpression,
  afterSettleExpression: afterSettleStateExpression,
  beforeSnapshotExpression: closeDelayedPopupExpression,
});

const html = result.renderedDocument.html;
const rootTag = html.match(/<[^>]+id="searchspring-category"[^>]*>/i)?.[0] || '';
const loadMoreTag = html.match(/<button[^>]+ss-load-more[^>]*>/i)?.[0] || '';
process.stdout.write(`${JSON.stringify({
  rootTag,
  loadMoreTag,
  productCards: (html.match(/\bproduct-card\b/g) || []).length,
  prefetchedCards: (html.match(/data-matbox-load-more-item/g) || []).length,
  trustedClick: html.match(/data-matbox-trusted-click="([^"]+)"/)?.[1] || null,
  trustedClickResult: rootTag.match(/data-matbox-trusted-click-result="([^"]+)"/)?.[1] || null,
  initialProductCount: rootTag.match(/data-matbox-initial-product-count="([^"]+)"/)?.[1] || null,
  finalProductCount: rootTag.match(/data-matbox-final-product-count="([^"]+)"/)?.[1] || null,
}, null, 2)}\n`);
