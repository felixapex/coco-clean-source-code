import { decodeCachedResourceText } from './capture-validation.mjs';

const REMOTE_OVERRIDE_ATTRIBUTES = [
  'srcset',
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-srcset',
  'data-lazy-srcset',
];

const ACTIVE_IMAGE_ATTRIBUTES = ['src', ...REMOTE_OVERRIDE_ATTRIBUTES];

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? null;
}

function removeAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.replace(new RegExp(`\\s+${escaped}\\s*=\\s*(["']).*?\\1`, 'gi'), '');
}

function upsertAttribute(tag, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const encoded = String(value || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const pattern = new RegExp(`((?:^|\\s)${escaped}\\s*=\\s*)(["']).*?\\2`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, `$1"${encoded}"`);
  return tag.replace(/\s*\/?\s*>$/, (ending) => ` ${name}="${encoded}"${ending}`);
}

function normalizedSource(value) {
  return String(value || '').replaceAll('&amp;', '&').trim();
}

function activeRecoveredReferencesInTag(tag, recoveredSources) {
  const references = [];
  for (const name of ACTIVE_IMAGE_ATTRIBUTES) {
    const value = normalizedSource(attribute(tag, name));
    if (!value) continue;
    const activeSources = recoveredSources.has(value)
      ? [value]
      : value.split(/[\s,]+/).filter((token) => recoveredSources.has(token));
    for (const source of new Set(activeSources)) references.push({ attribute: name, source });
  }
  return references;
}

export function decodeCachedImageRecovery(cacheEnvelope, expected = {}) {
  const decoded = decodeCachedResourceText(cacheEnvelope);
  const expectedSource = String(expected.sourceUrl || '').trim();
  const expectedContentType = String(expected.contentType || '').trim().toLowerCase();
  const expectedByteLength = Number(expected.byteLength);
  if (expectedSource && decoded.sourceUrl !== expectedSource) {
    throw new Error(`cached resource source mismatch: ${decoded.sourceUrl}`);
  }
  if (expectedContentType && decoded.contentType.toLowerCase() !== expectedContentType) {
    throw new Error(`cached resource content type mismatch: ${decoded.contentType}`);
  }
  if (Number.isFinite(expectedByteLength) && decoded.buffer.length !== expectedByteLength) {
    throw new Error(`cached resource byte length mismatch: ${decoded.buffer.length}`);
  }
  return {
    ...decoded,
    dataUrl: `data:${decoded.contentType};base64,${decoded.buffer.toString('base64')}`,
  };
}

export function localizeRecoveredImages(html, recoveryBySource = new Map()) {
  let replaced = 0;
  const replacementsBySource = {};
  const alreadyLocalizedBySource = {};
  const remainingActiveReferences = [];
  const recoveredSources = new Set([...recoveryBySource.keys()].map(normalizedSource));
  const output = String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const rawSource = attribute(tag, 'src');
    const source = normalizedSource(rawSource);
    const originalSource = normalizedSource(attribute(tag, 'data-matbox-original-source-url'));
    const activeRecoveredReferences = activeRecoveredReferencesInTag(tag, recoveredSources);
    const recoveredOverrideSource = activeRecoveredReferences.find(({ attribute: name }) => name !== 'src')?.source ?? '';
    let localized = tag;
    if (source.startsWith('data:image/') && recoveryBySource.has(originalSource) && !recoveredOverrideSource) {
      alreadyLocalizedBySource[originalSource] = (alreadyLocalizedBySource[originalSource] || 0) + 1;
    } else {
      const recoverySource = recoveryBySource.has(source) ? source : recoveredOverrideSource;
      const recovery = recoveryBySource.get(recoverySource);
      if (recovery?.dataUrl) {
        if (!source.startsWith('data:image/')) {
          localized = upsertAttribute(localized, 'src', recovery.dataUrl);
        }
        for (const name of REMOTE_OVERRIDE_ATTRIBUTES) localized = removeAttribute(localized, name);
        if (Number(recovery.intrinsicWidth) > 0 && Number(recovery.intrinsicHeight) > 0) {
          localized = upsertAttribute(localized, 'data-matbox-image-intrinsic-width', recovery.intrinsicWidth);
          localized = upsertAttribute(localized, 'data-matbox-image-intrinsic-height', recovery.intrinsicHeight);
        }
        localized = upsertAttribute(localized, 'data-matbox-original-source-url', recoverySource);
        localized = upsertAttribute(localized, 'data-matbox-original-src', recoverySource);
        replaced += 1;
        replacementsBySource[recoverySource] = (replacementsBySource[recoverySource] || 0) + 1;
      }
    }
    remainingActiveReferences.push(...activeRecoveredReferencesInTag(localized, recoveredSources));
    return localized;
  });
  return {
    html: output,
    replaced,
    replacementsBySource,
    alreadyLocalizedBySource,
    remainingActiveReferences,
  };
}

export function findActiveRecoveredImageReferences(html, recoveredSources = new Set()) {
  const normalizedRecoveredSources = new Set([...recoveredSources].map(normalizedSource));
  const references = [];
  for (const match of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    references.push(...activeRecoveredReferencesInTag(match[0], normalizedRecoveredSources));
  }
  return references;
}
