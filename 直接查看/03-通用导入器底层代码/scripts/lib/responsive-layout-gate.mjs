export function overlapRatio(left, right) {
  const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlapWidth * overlapHeight / smallerArea : 0;
}

export function findDuplicateTextOverlaps(textNodes, limit = 20) {
  const groups = new Map();
  for (const item of textNodes || []) {
    if (!item?.text || !item?.rect) continue;
    const group = groups.get(item.text) || [];
    group.push(item);
    groups.set(item.text, group);
  }
  const overlaps = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
    for (let index = 0; index < group.length; index += 1) {
      const left = group[index];
      for (let peerIndex = index + 1; peerIndex < group.length; peerIndex += 1) {
        const right = group[peerIndex];
        if (right.rect.top > left.rect.bottom) break;
        if (left.node?.contains?.(right.node) || right.node?.contains?.(left.node)) continue;
        const overlapWidth = Math.max(0, Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left));
        const overlapHeight = Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
        const smallerArea = Math.min(left.rect.width * left.rect.height, right.rect.width * right.rect.height);
        if (smallerArea <= 0 || overlapWidth * overlapHeight / smallerArea < 0.15) continue;
        overlaps.push({
          text: left.text.slice(0, 80),
          first: [Math.round(left.rect.left), Math.round(left.rect.top), Math.round(left.rect.width), Math.round(left.rect.height)],
          second: [Math.round(right.rect.left), Math.round(right.rect.top), Math.round(right.rect.width), Math.round(right.rect.height)],
          firstHtml: String(left.html || left.node?.outerHTML || '').slice(0, 300),
          secondHtml: String(right.html || right.node?.outerHTML || '').slice(0, 300),
        });
        if (overlaps.length >= limit) return overlaps;
      }
    }
  }
  return overlaps;
}

export function findSectionRightGaps(contentRects, viewportWidth, limit = 20) {
  const peersAtRightEdge = (contentRects || []).filter(({ rect }) => (
    rect && rect.right >= viewportWidth - 2 && rect.width > 1 && rect.height > 1
  ));
  const gaps = [];
  for (const { node, rect } of contentRects || []) {
    if (!rect || rect.height <= 180 || rect.width < viewportWidth * 0.5 || rect.left > 2 || viewportWidth - rect.right <= 2) continue;
    const filledByPeer = peersAtRightEdge.some(({ node: peer, rect: peerRect }) => {
      if (peer === node || node?.contains?.(peer) || peer?.contains?.(node)) return false;
      if (peerRect.left < rect.right - 2) return false;
      const verticalOverlap = Math.max(0, Math.min(rect.bottom, peerRect.bottom) - Math.max(rect.top, peerRect.top));
      return verticalOverlap >= Math.min(rect.height, peerRect.height) * 0.5;
    });
    if (!filledByPeer) gaps.push(rect);
    if (gaps.length >= limit) break;
  }
  return gaps;
}

export function auditedRoutePathname(route) {
  return new URL(route, 'http://audit.local').pathname.replace(/\/$/, '');
}

export function findPrimaryContentRightBoundary(mainNode, viewportWidth, readStyle = globalThis.getComputedStyle) {
  for (let parent = mainNode?.parentElement; parent; parent = parent.parentElement) {
    const style = readStyle?.(parent);
    const overflow = `${style?.overflow || ''} ${style?.overflowY || ''}`;
    if (!/\b(?:auto|scroll)\b/.test(overflow)) continue;
    const rect = parent.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(parent.clientWidth)) continue;
    return Math.min(viewportWidth, rect.left + parent.clientWidth);
  }
  return viewportWidth;
}

function fixedPageWidthCandidates(metrics, width) {
  return metrics.rightGapCandidates.filter((item) => {
    const maxWidth = String(item.computedMaxWidth || '');
    const maxWidthPixels = maxWidth.endsWith('px') ? Number.parseFloat(maxWidth) : Number.NaN;
    const pageContainer = /\b(?:container|page|layout|wrapper)\b/i.test(String(item.className || ''))
      || /^(?:MAIN|SECTION)$/i.test(String(item.tag || ''));
    return Number.isFinite(maxWidthPixels)
      && pageContainer
      && maxWidthPixels >= 1000
      && item.parent?.width >= width * 0.95
      && item.width <= width * 0.9
      && item.parentWidthRatio >= 0.55
      && (item.parentLeftGap >= 100 || item.parentRightGap >= 100)
      && Math.abs(item.parentLeftGap - item.parentRightGap) >= 100;
  });
}

export function classifyResponsiveFailures({ metrics, width }) {
  const failures = [];
  if (metrics.scrollWidth > width + 2) failures.push(`document-overflow:${metrics.scrollWidth - width}px`);
  if (metrics.mediaGaps.length) failures.push(`full-bleed-media-gap:${metrics.mediaGaps.length}`);
  if (metrics.primaryContentGap > 2) failures.push(`primary-content-right-gap:${metrics.primaryContentGap}px`);
  if (metrics.largeRightGaps.length) failures.push(`large-root-right-gap:${metrics.largeRightGaps.length}`);

  const fixedPageWidths = fixedPageWidthCandidates(metrics, width);
  if (fixedPageWidths.length) failures.push(`fixed-page-width:${fixedPageWidths.length}`);

  const frozenComponentRightGaps = metrics.rightGapCandidates.filter((item) => (
    item.frozenComponent
    && item.parent
    && item.parent.width >= width * 0.8
    && item.parentLeftGap >= -2
    && item.parentLeftGap <= 100
    && item.parentRightGap >= 100
    && item.parentWidthRatio >= 0.7
  ));
  if (frozenComponentRightGaps.length) failures.push(`frozen-component-right-gap:${frozenComponentRightGaps.length}`);
  if (metrics.duplicateOverlaps.length) failures.push(`duplicate-text-overlap:${metrics.duplicateOverlaps.length}`);
  return failures;
}
