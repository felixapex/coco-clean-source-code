export function shouldPromoteDeferredImage({ allowNetwork, currentSource, deferredSource, frozen } = {}) {
  if (!deferredSource || frozen || allowNetwork === false) return false;
  return !currentSource || String(currentSource).startsWith('data:');
}

export function browserImageReadinessPolicySource() {
  return `(${shouldPromoteDeferredImage.toString()})`;
}
