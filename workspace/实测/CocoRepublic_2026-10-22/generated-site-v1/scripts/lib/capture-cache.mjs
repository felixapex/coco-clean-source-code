import crypto from 'node:crypto';

export const CAPTURE_CONTRACT_VERSION = 'rendered-golden-v23';
export const DEFAULT_CAPTURE_RESUME_MAX_AGE_MS = 30 * 60 * 1000;

export function captureContentSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedSourceUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}

function sourceOrigin(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

export function isReusableCaptureMetadata(metadata, {
  route,
  sourceUrl,
  now = Date.now(),
  maxAgeMs = DEFAULT_CAPTURE_RESUME_MAX_AGE_MS,
  replaySha256,
  screenshotSha256,
}) {
  const readiness = metadata?.metadata?.visualReadiness;
  const capturedAt = Date.parse(metadata?.capturedAt || '');
  const ageMs = Number(now) - capturedAt;
  const exactSourceMatch = normalizedSourceUrl(metadata?.sourceUrl) === normalizedSourceUrl(sourceUrl);
  const sameSourceOrigin = sourceOrigin(metadata?.sourceUrl) === sourceOrigin(sourceUrl);
  const sealedHashesMatch = Boolean(
    metadata?.contentHashes?.replaySha256
    && metadata?.contentHashes?.screenshotSha256
    && metadata.contentHashes.replaySha256 === replaySha256
    && metadata.contentHashes.screenshotSha256 === screenshotSha256,
  );
  return Boolean(
    metadata
    && metadata.captureContractVersion === CAPTURE_CONTRACT_VERSION
    && metadata.route === route
    && readiness
    && Number.isFinite(readiness.failedStylesheets)
    && readiness.failedStylesheets === 0
    && Number.isFinite(readiness.uncapturedStylesheets)
    && readiness.uncapturedStylesheets === 0
    && Number.isFinite(readiness.horizontalOverflowPx)
    && readiness.horizontalOverflowPx <= 2
    && Array.isArray(metadata.interactiveElements)
    && Array.isArray(metadata.links)
    && Number.isFinite(capturedAt)
    && (
      (sealedHashesMatch && sameSourceOrigin)
      || (exactSourceMatch && ageMs >= 0 && ageMs <= Number(maxAgeMs))
    ),
  );
}
