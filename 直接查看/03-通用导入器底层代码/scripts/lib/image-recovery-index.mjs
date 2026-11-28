function normalizedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.search = '';
    return url;
  } catch {
    return null;
  }
}

export function imageSourceIdentity(value) {
  const url = normalizedUrl(value);
  if (!url) return String(value || '').split(/[?#]/, 1)[0];
  const pathname = url.pathname.replace(
    /\/images\/stencil\/(?:original|\d+w)\/(products\/)/i,
    '/images/stencil/{size}/$1',
  );
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`;
}

function reusableCurrentSource(value) {
  const source = String(value || '');
  return /^data:image\//i.test(source) || /^\/(?!\/)/.test(source) || /^\.\.?\//.test(source);
}

export function selectReusableImageCandidate(targetSource, candidates = []) {
  const identity = imageSourceIdentity(targetSource);
  const exact = normalizedUrl(targetSource)?.href || String(targetSource || '');
  const valid = candidates.filter((candidate) => (
    imageSourceIdentity(candidate?.originalSource) === identity
    && reusableCurrentSource(candidate?.currentSource)
    && Number(candidate?.intrinsicWidth) > 0
    && Number(candidate?.intrinsicHeight) > 0
    && candidate?.screenshotDerived !== true
  ));
  valid.sort((left, right) => {
    const leftExact = (normalizedUrl(left.originalSource)?.href || left.originalSource) === exact ? 1 : 0;
    const rightExact = (normalizedUrl(right.originalSource)?.href || right.originalSource) === exact ? 1 : 0;
    if (rightExact !== leftExact) return rightExact - leftExact;
    return (Number(right.intrinsicWidth) * Number(right.intrinsicHeight))
      - (Number(left.intrinsicWidth) * Number(left.intrinsicHeight));
  });
  return valid[0] || null;
}
