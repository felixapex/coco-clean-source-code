import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stableStateExpression, closeDelayedPopupExpression, afterSettleStateExpression } from '../scripts/lib/capture-state.mjs';

test('golden capture and fidelity audit share one deterministic page-state contract', async () => {
  const [captureSource, auditSource] = await Promise.all([
    fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/audit-full-site-fidelity.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(captureSource, /from '.\/lib\/capture-state\.mjs'/);
  assert.match(auditSource, /from '.\/lib\/capture-state\.mjs'/);
  assert.match(stableStateExpression, /\.ss-load-more/);
  assert.match(stableStateExpression, /loadMore\.click\(\)/);
  assert.match(stableStateExpression, /maxLoadMoreRounds/);
  assert.match(stableStateExpression, /data-matbox-test-expand-commerce/);
  assert.match(stableStateExpression, /image\.loading = 'eager'/);
  assert.match(stableStateExpression, /image\.classList\.remove\('lazyload', 'lazyloading'\)/);
  assert.match(stableStateExpression, /image\.classList\.add\('lazyloaded'\)/);
  assert.match(stableStateExpression, /#searchspring-category/);
  assert.match(stableStateExpression, /commerceWaitMs = interactionAudit \? 1500 : 20000/);
  assert.match(stableStateExpression, /isProductDetailPage/);
  assert.match(stableStateExpression, /!isProductDetailPage && \(\(!isLocalReplay/);
  assert.match(stableStateExpression, /localhost/);
  assert.match(stableStateExpression, /127\.0\.0\.1/);
  assert.match(stableStateExpression, /!isLocalReplay \|\| forceCommerceExpansion/);
  assert.match(stableStateExpression, /!window\.__matboxUseTrustedClick/);
  assert.match(stableStateExpression, /window\.__matboxInteractionAudit/);
  assert.doesNotMatch(stableStateExpression, /for \(let y = 0; y <= bottom/);
  assert.doesNotMatch(afterSettleStateExpression, /stableStateExpression/);
  assert.match(afterSettleStateExpression, /MutationObserver/);
  assert.match(afterSettleStateExpression, /stableInteractionSamples/);
  assert.match(afterSettleStateExpression, /interactionSignature/);
  assert.match(afterSettleStateExpression, /minimumDelayedMountMs/);
  assert.match(afterSettleStateExpression, /maximumDelayedMountMs/);
  assert.match(closeDelayedPopupExpression, /data-subscription-popup-close/);
  assert.match(closeDelayedPopupExpression, /fancybox-close/);
  assert.match(closeDelayedPopupExpression, /removeProperty\('overflow'\)/);
  assert.ok((afterSettleStateExpression.match(/fancybox-close/g) || []).length >= 2, 'capture must close popups both before and after the delayed widget-mount window');
});
