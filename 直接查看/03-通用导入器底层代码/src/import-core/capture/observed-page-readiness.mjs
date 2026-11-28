const NON_BLOCKING_RESOURCE_TYPES = new Set([
  'CSPViolationReport',
  'EventSource',
  'Media',
  'Ping',
  'Prefetch',
  'Preflight',
  'WebSocket',
]);

const NON_BLOCKING_DELIVERY_URLS = [
  /(?:^|\.)googleadservices\.com$/i,
  /(?:^|\.)google-analytics\.com$/i,
  /(?:^|\.)googletagmanager\.com$/i,
  /(?:^|\.)doubleclick\.net$/i,
  /(?:^|\.)clarity\.ms$/i,
  /^analytics\.tiktok\.com$/i,
];

function isNonBlockingDeliveryUrl(value = '') {
  try {
    const url = new URL(String(value));
    if (/^\/cdn-cgi\/challenge-platform\//i.test(url.pathname)) return true;
    if (NON_BLOCKING_DELIVERY_URLS.some((pattern) => pattern.test(url.hostname))) return true;
    if (/(?:^|\.)google\.com$/i.test(url.hostname) && /^\/pagead\//i.test(url.pathname)) return true;
    if (/^s\.pinimg\.com$/i.test(url.hostname) && /^\/ct\//i.test(url.pathname)) return true;
  } catch {}
  return false;
}

function isRelevantRequest(params = {}, mainFrameId = '') {
  if (mainFrameId && params.frameId && params.frameId !== mainFrameId) return false;
  if (isNonBlockingDeliveryUrl(params.request?.url)) return false;
  return !NON_BLOCKING_RESOURCE_TYPES.has(String(params.type || 'Other'));
}

function requestOrigin(value = '') {
  try { return new URL(String(value)).origin; } catch { return ''; }
}

function isThirdPartyEnhancement(params = {}, documentOrigin = '') {
  const type = String(params.type || 'Other');
  if (!['Fetch', 'Other', 'Script', 'XHR'].includes(type) || !documentOrigin) return false;
  const origin = requestOrigin(params.request?.url);
  return Boolean(origin && origin !== documentOrigin);
}

function timeoutError(details) {
  const error = new Error(`Observed page readiness timed out after ${details.waitedMs}ms`);
  error.code = 'OBSERVED_READINESS_TIMEOUT';
  error.details = details;
  return error;
}

export async function createObservedPageReadinessMonitor(client, options = {}) {
  const now = options.now || (() => Date.now());
  const trackNetwork = options.trackNetwork !== false;
  const pending = new Map();
  let lastRelevantNetworkActivityAt = now();
  let documentOrigin = '';
  let mainFrameId = '';
  let offRequest = () => {};
  let offFinished = () => {};
  let offFailed = () => {};
  if (trackNetwork) {
    const frameTree = await client.send('Page.getFrameTree');
    mainFrameId = String(frameTree.frameTree?.frame?.id || '');
    await client.send('Network.enable');
    offRequest = client.onEvent('Network.requestWillBeSent', (params = {}) => {
      if (String(params.type || '') === 'Document' && (!mainFrameId || params.frameId === mainFrameId)) {
        documentOrigin = requestOrigin(params.request?.url) || documentOrigin;
      }
      if (!params.requestId || !isRelevantRequest(params, mainFrameId)) return;
      const enhancement = isThirdPartyEnhancement(params, documentOrigin);
      pending.set(params.requestId, {
        requestId: params.requestId,
        type: String(params.type || 'Other'),
        url: String(params.request?.url || ''),
        enhancement,
      });
      if (!enhancement) lastRelevantNetworkActivityAt = now();
    });
  }
  const settleRequest = (params = {}) => {
    if (!params.requestId || !pending.has(params.requestId)) return;
    const entry = pending.get(params.requestId);
    pending.delete(params.requestId);
    if (!entry?.enhancement) lastRelevantNetworkActivityAt = now();
  };
  if (trackNetwork) {
    offFinished = client.onEvent('Network.loadingFinished', settleRequest);
    offFailed = client.onEvent('Network.loadingFailed', settleRequest);
  }

  return {
    async waitForStable({
      sample,
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      quietWindowMs = 500,
      maxWaitMs = 10000,
      pollIntervalMs = 100,
    } = {}) {
      if (typeof sample !== 'function') throw new TypeError('Observed readiness requires a sample function');
      const startedAt = now();
      let lastContentActivityAt = startedAt;
      let previousSignature;
      let previousReady;
      let samples = 0;

      while (true) {
        const current = await sample();
        const signature = String(current?.signature || '');
        const ready = current?.ready !== false;
        samples += 1;
        if (previousSignature === undefined || signature !== previousSignature || ready !== previousReady) {
          previousSignature = signature;
          previousReady = ready;
          lastContentActivityAt = now();
        }

        const currentTime = now();
        const waitedMs = currentTime - startedAt;
        const pendingEntries = [...pending.values()];
        const meaningfulContent = current?.meaningfulContent === true;
        const sampledPendingImages = Number(current?.pendingImages);
        const canDeferNetworkImages = meaningfulContent
          && ready
          && (current?.visualResourcesDelegated === true
            || (Number.isFinite(sampledPendingImages) && sampledPendingImages === 0));
        const pendingVisualGate = canDeferNetworkImages
          ? pendingEntries.filter((entry) => !entry.enhancement && entry.type === 'Image')
          : [];
        const pendingVisualGateIds = new Set(pendingVisualGate.map((entry) => entry.requestId));
        const pendingEnhancements = meaningfulContent
          ? pendingEntries.filter((entry) => entry.enhancement)
          : [];
        const pendingBlocking = meaningfulContent
          ? pendingEntries.filter((entry) => !entry.enhancement && !pendingVisualGateIds.has(entry.requestId))
          : pendingEntries;
        const details = {
          reason: 'observed-stable',
          waitedMs,
          samples,
          quietWindowMs,
          signature,
          ready,
          meaningfulContent,
          pendingRelevantRequests: pendingBlocking.length,
          pending: pendingBlocking,
          pendingEnhancementRequests: pendingEnhancements.length,
          pendingEnhancements,
          pendingVisualGateRequests: pendingVisualGate.length,
          pendingVisualGate,
          contentQuietMs: currentTime - lastContentActivityAt,
          networkQuietMs: currentTime - lastRelevantNetworkActivityAt,
        };

        if (
          ready
          && pendingBlocking.length === 0
          && details.contentQuietMs >= quietWindowMs
          && details.networkQuietMs >= quietWindowMs
        ) return details;

        if (waitedMs >= maxWaitMs) {
          details.reason = 'timeout';
          throw timeoutError(details);
        }
        await sleep(Math.min(pollIntervalMs, Math.max(1, maxWaitMs - waitedMs)));
      }
    },
    snapshot() {
      return {
        pendingRelevantRequests: pending.size,
        pending: [...pending.values()],
        lastRelevantNetworkActivityAt,
      };
    },
    close() {
      offRequest?.();
      offFinished?.();
      offFailed?.();
    },
  };
}

export async function sampleObservedPageState(client) {
  const evaluated = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && !element.closest('[hidden],[aria-hidden="true"]');
      };
      const images = Array.from(document.images).filter((image) => {
        const source = image.currentSrc || image.src || image.dataset.src || '';
        return Boolean(source) && visible(image);
      });
      const pendingImages = images.filter((image) => !image.complete || image.naturalWidth <= 0).length;
      const controls = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"]'))
        .filter(visible);
      const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
      let textHash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        textHash ^= text.charCodeAt(index);
        textHash = Math.imul(textHash, 16777619);
      }
      const imageSignature = images.map((image) => [
        image.currentSrc || image.src || image.dataset.src || '',
        image.complete ? 1 : 0,
        image.naturalWidth || 0,
        image.naturalHeight || 0,
      ].join(':')).sort().join('|');
      const contentSignature = JSON.stringify({
        readyState: document.readyState,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        textLength: text.length,
        textHash: textHash >>> 0,
        controls: controls.length,
        images: images.length,
        imageSources: images.map((image) => image.currentSrc || image.src || image.dataset.src || '').sort(),
      });
      const signature = JSON.stringify({
        readyState: document.readyState,
        fontStatus: document.fonts?.status || 'loaded',
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        textLength: text.length,
        textHash: textHash >>> 0,
        controls: controls.length,
        images: images.length,
        pendingImages,
        imageSignature,
      });
      return {
        signature,
        contentSignature,
        meaningfulContent: text.length > 0 || controls.length > 0 || images.length > 0,
        pendingImages,
        documentReady: document.readyState !== 'loading',
        ready: document.readyState !== 'loading'
          && (document.fonts?.status || 'loaded') !== 'loading'
          && pendingImages === 0,
      };
    })()`,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    const detail = evaluated.exceptionDetails.exception?.description
      || evaluated.exceptionDetails.text
      || 'unknown readiness sampling error';
    throw new Error(`Observed readiness sampling failed: ${detail}`);
  }
  return evaluated.result?.value || { signature: '', ready: false };
}
