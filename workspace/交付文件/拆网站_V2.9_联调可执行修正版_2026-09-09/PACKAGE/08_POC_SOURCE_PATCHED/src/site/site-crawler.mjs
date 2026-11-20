import { resolveAndValidateUrl } from '../security/url-policy.mjs';
import { discoverInternalLinks } from './link-discovery.mjs';

export async function crawlSite({
  startUrl,
  captureFn,
  resolver,
  maxPages = 20,
  linkOptions = {},
  failFast = false,
  captureRetries = 1,
  retryDelayMs = 50,
  visitPolicy = null,
}) {
  if (typeof captureFn !== 'function') throw new Error('captureFn is required');
  if (!(Number.isInteger(maxPages) && maxPages > 0)) throw new Error('maxPages must be a positive integer');

  const validatedStart = await resolveAndValidateUrl(startUrl, { resolver });
  const canonicalStart = validatedStart.url.href;
  const queue = [canonicalStart];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const errors = [];
  const skipped = [];

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      await resolveAndValidateUrl(url, { resolver });
      if (visitPolicy) {
        const verdict = await visitPolicy(url);
        if (verdict === false || verdict?.allowed === false) {
          skipped.push({ url, reason: verdict?.reason ?? 'visit-policy' });
          continue;
        }
      }
      let capture;
      let lastError;
      for (let attempt = 0; attempt <= captureRetries; attempt++) {
        try {
          capture = await captureFn(url);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < captureRetries && retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      if (lastError) throw lastError;
      pages.push({ url, capture });
      const links = discoverInternalLinks(canonicalStart, capture.links ?? [], linkOptions);
      for (const link of links) {
        if (!queued.has(link) && !visited.has(link)) {
          queued.add(link);
          queue.push(link);
        }
      }
    } catch (error) {
      errors.push({ url, message: String(error?.message ?? error) });
      if (failFast) throw error;
    }
  }

  return { startUrl: canonicalStart, pages, errors, skipped };
}
