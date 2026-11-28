function errorText(error) {
  return `${error?.name || ''} ${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
}

export function classifyImageFetchFailure(error = {}) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status) return { kind: 'source', signature: `http-${status}`, status };
  const text = errorText(error);
  if (error?.name === 'AbortError' || /abort|timed?\s*out|timeout/.test(text)) {
    return { kind: 'network', signature: 'timeout' };
  }
  if (/econnreset|connection[_ -]?reset|socket hang up/.test(text)) {
    return { kind: 'network', signature: 'connection-reset' };
  }
  if (/enotfound|name_not_resolved|dns/.test(text)) {
    return { kind: 'network', signature: 'dns' };
  }
  if (/econnrefused|connection[_ -]?refused/.test(text)) {
    return { kind: 'network', signature: 'connection-refused' };
  }
  if (/fetch failed|network|socket|tls|certificate/.test(text)) {
    return { kind: 'network', signature: 'network-error' };
  }
  return { kind: 'content', signature: 'invalid-image-content' };
}

export function createHostCircuit({ consecutiveNetworkLimit = 3 } = {}) {
  const state = {
    open: false,
    reason: '',
    consecutiveNetworkFailures: 0,
    lastNetworkSignature: '',
    successCount: 0,
    sourceFailureCount: 0,
    contentFailureCount: 0,
  };
  return {
    record(result = {}) {
      if (state.open) return { ...state };
      if (result.ok) {
        state.successCount += 1;
        state.consecutiveNetworkFailures = 0;
        state.lastNetworkSignature = '';
        return { ...state };
      }
      const classification = result.classification || classifyImageFetchFailure(result.error);
      if (classification.kind !== 'network') {
        state.consecutiveNetworkFailures = 0;
        state.lastNetworkSignature = '';
        if (classification.kind === 'source') state.sourceFailureCount += 1;
        else state.contentFailureCount += 1;
        return { ...state };
      }
      if (classification.signature === state.lastNetworkSignature) state.consecutiveNetworkFailures += 1;
      else {
        state.lastNetworkSignature = classification.signature;
        state.consecutiveNetworkFailures = 1;
      }
      if (state.consecutiveNetworkFailures >= consecutiveNetworkLimit) {
        state.open = true;
        state.reason = `network:${classification.signature}`;
      }
      return { ...state };
    },
    snapshot() {
      return { ...state };
    },
  };
}

export function imageFetchCandidates(source) {
  const result = [String(source || '')];
  try {
    const url = new URL(source);
    if (/bigcommerce\.com$/i.test(url.hostname) && /\/images\/stencil\/(?:original|\d+w)\/products\//i.test(url.pathname)) {
      for (const size of ['original', '1280x1280', '960w', '768w']) {
        const candidate = new URL(url);
        candidate.pathname = candidate.pathname.replace(/\/images\/stencil\/(?:original|\d+w)\/products\//i, `/images/stencil/${size}/products/`);
        result.push(candidate.href);
      }
    }
  } catch {}
  return [...new Set(result.filter(Boolean))];
}

export function shouldTryNextCandidate(classification) {
  return classification?.kind === 'source' && classification?.status === 404;
}

export function imageProxyUrl(source, base = 'https://images.weserv.nl/') {
  const proxy = new URL(base);
  proxy.searchParams.set('url', String(source || ''));
  return proxy.href;
}

export function cloudinaryImageUrl(source, cloudName = 'demo') {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/fetch/${String(source || '')}`;
}

export function isImageResponse({ contentType = '', buffer } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  const type = String(contentType).toLowerCase();
  if (!type.startsWith('image/')) return false;
  if (type.includes('svg')) {
    const prefix = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).replace(/^\uFEFF/, '');
    return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(prefix);
  }
  const hex = buffer.subarray(0, 12).toString('hex');
  const ascii = buffer.subarray(0, 12).toString('ascii');
  return hex.startsWith('ffd8ff')
    || hex.startsWith('89504e470d0a1a0a')
    || ascii.startsWith('GIF87a')
    || ascii.startsWith('GIF89a')
    || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    || hex.startsWith('00000100')
    || (hex.startsWith('424d'));
}

export async function fetchImageWithFallback(source, {
  fetchImpl = fetch,
  networkFallbackImpl = null,
  timeoutMs = 20_000,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MatboxImageRecovery/1.0',
} = {}) {
  const attempts = [];
  for (const candidate of imageFetchCandidates(source)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(candidate, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': userAgent, accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
      });
      if (!response.ok) {
        const error = Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        const classification = classifyImageFetchFailure(error);
        attempts.push({ candidate, ok: false, classification });
        if (shouldTryNextCandidate(classification)) continue;
        return { ok: false, source, attempts, classification, error: error.message };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      if (!isImageResponse({ contentType, buffer })) {
        const error = new Error('invalid image response');
        const classification = classifyImageFetchFailure(error);
        attempts.push({ candidate, ok: false, classification });
        return { ok: false, source, attempts, classification, error: error.message };
      }
      attempts.push({ candidate, ok: true, transport: 'fetch', contentType, byteLength: buffer.length });
      return { ok: true, source, resolvedSource: candidate, transport: 'fetch', contentType, buffer, attempts };
    } catch (error) {
      const classification = classifyImageFetchFailure(error);
      attempts.push({ candidate, ok: false, transport: 'fetch', classification, error: String(error?.message || error) });
      if (classification.kind === 'network' && typeof networkFallbackImpl === 'function') {
        try {
          const fallback = await networkFallbackImpl(candidate, { timeoutMs, userAgent });
          const fallbackContentType = fallback?.contentType || '';
          const fallbackBuffer = Buffer.isBuffer(fallback?.buffer) ? fallback.buffer : Buffer.from(fallback?.buffer || []);
          if (fallback?.ok && isImageResponse({ contentType: fallbackContentType, buffer: fallbackBuffer })) {
            attempts.push({
              candidate,
              ok: true,
              transport: 'system',
              contentType: fallbackContentType,
              byteLength: fallbackBuffer.length,
            });
            return {
              ok: true,
              source,
              resolvedSource: fallback.resolvedSource || candidate,
              transport: 'system',
              contentType: fallbackContentType,
              buffer: fallbackBuffer,
              attempts,
            };
          }
          const fallbackError = fallback?.ok
            ? new Error('invalid image response from system transport')
            : Object.assign(new Error(fallback?.error || `HTTP ${fallback?.status || 0}`), { status: fallback?.status || 0 });
          const fallbackClassification = fallback?.ok
            ? { kind: 'content', signature: 'invalid-image-content' }
            : classifyImageFetchFailure(fallbackError);
          attempts.push({
            candidate,
            ok: false,
            transport: 'system',
            classification: fallbackClassification,
            error: fallbackError.message,
          });
          if (shouldTryNextCandidate(fallbackClassification)) continue;
          return {
            ok: false,
            source,
            attempts,
            classification: fallbackClassification,
            error: fallbackError.message,
          };
        } catch (fallbackError) {
          const fallbackClassification = classifyImageFetchFailure(fallbackError);
          attempts.push({
            candidate,
            ok: false,
            transport: 'system',
            classification: fallbackClassification,
            error: String(fallbackError?.message || fallbackError),
          });
        }
      }
      return { ok: false, source, attempts, classification, error: String(error?.message || error) };
    } finally {
      clearTimeout(timeout);
    }
  }
  const classification = { kind: 'source', signature: 'all-candidates-404', status: 404 };
  return { ok: false, source, attempts, classification, error: 'all candidates returned 404' };
}
