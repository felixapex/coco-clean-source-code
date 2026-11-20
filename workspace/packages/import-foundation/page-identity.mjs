import { createHash } from 'node:crypto';

const TRACKING_PARAMETER = /^(utm_.+|gclid|fbclid|msclkid)$/i;

function defaultNumericIdFactory(seed, attempt = 0) {
  const digest = createHash('sha256').update(`${seed}#${attempt}`).digest('hex');
  const value = (BigInt(`0x${digest.slice(0, 16)}`) % 9000000000000000n) + 1000000000000000n;
  return value.toString();
}

function cloneRegistry(registry) {
  return {
    version: registry?.version ?? 1,
    pages: { ...(registry?.pages ?? {}) },
    platformIds: { ...(registry?.platformIds ?? {}) },
  };
}

function normalizeUrl(sourceUrl) {
  if (!sourceUrl) throw new TypeError('sourceUrl is required');
  const url = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('sourceUrl must use http or https');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createEmptyPageIdentityRegistry() {
  return { version: 1, pages: {}, platformIds: {} };
}

export function normalizeSourcePageIdentity(input) {
  const platform = String(input?.platform ?? '').trim().toLowerCase();
  if (!platform) throw new TypeError('platform is required');
  const sourcePageId = String(input?.sourcePageId ?? '').trim() || null;
  const sourceUrl = normalizeUrl(input?.sourceUrl);
  const identityKey = sourcePageId
    ? `${platform}:source:${sourcePageId}`
    : `${platform}:url:${sourceUrl}`;

  return {
    platform,
    sourcePageId,
    sourceUrl,
    sourcePageName: String(input?.sourcePageName ?? '').trim() || null,
    canonicalRoute: String(input?.canonicalRoute ?? '').trim() || null,
    identityKey,
  };
}

function allocatePlatformPageId(identityKey, registry, idFactory) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = String(idFactory(identityKey, attempt));
    if (!/^\d{16}$/.test(candidate)) {
      throw new TypeError('platformPageId factory must return exactly 16 digits');
    }
    const owner = registry.platformIds[candidate];
    if (!owner || owner === identityKey) return candidate;
  }
  throw new Error('PAGE_IDENTITY_CONFLICT: unable to allocate a unique platformPageId');
}

export function assignPageIdentity(input, registry = createEmptyPageIdentityRegistry(), options = {}) {
  const normalized = normalizeSourcePageIdentity(input);
  const nextRegistry = cloneRegistry(registry);
  const now = options.now ?? new Date().toISOString();
  const importRunId = String(input?.importRunId ?? '').trim();
  if (!importRunId) throw new TypeError('importRunId is required');

  const previous = nextRegistry.pages[normalized.identityKey];
  const platformPageId = previous?.platformPageId ?? allocatePlatformPageId(
    normalized.identityKey,
    nextRegistry,
    options.idFactory ?? defaultNumericIdFactory,
  );
  const importPageId = defaultNumericIdFactory(`import:${importRunId}:${normalized.identityKey}`);

  const record = {
    ...normalized,
    importPageId,
    platformPageId,
    firstImportedAt: previous?.firstImportedAt ?? now,
    lastImportedAt: now,
  };

  nextRegistry.pages[normalized.identityKey] = record;
  nextRegistry.platformIds[platformPageId] = normalized.identityKey;
  return { record, registry: nextRegistry };
}

