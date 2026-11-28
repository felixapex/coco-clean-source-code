import { classifyVisibleAnchor } from './visible-anchor-gate.mjs';

export function classifyPostClickNavigation({
  beforeUrl,
  afterUrl,
  localOrigin,
  generatedRoutes,
  sourceOrigins = new Set(),
  interactionRedirects = {},
} = {}) {
  let before;
  let after;
  try {
    before = new URL(beforeUrl, localOrigin);
    after = new URL(afterUrl, localOrigin);
  } catch {
    return { kind: 'failure', type: 'invalid-button-navigation', target: String(afterUrl || '') };
  }
  if (`${before.origin}${before.pathname}${before.search}${before.hash}` === `${after.origin}${after.pathname}${after.search}${after.hash}`) {
    return { kind: 'unchanged' };
  }
  const classification = classifyVisibleAnchor({
    href: after.href,
    localOrigin,
    generatedRoutes,
    sourceOrigins,
    interactionRedirects,
  });
  if (classification.kind === 'local') return {
    kind: 'local-navigation',
    target: classification.target,
    pathname: classification.pathname,
  };
  if (classification.kind === 'failure') return classification;
  return { kind: 'failure', type: 'external-button-navigation', target: after.href };
}

export function isExpectedNoChange({ control = {}, outcome = {} } = {}) {
  return (
    (String(control.className || '').includes('product-card-swatch-button')
      && (control.ariaPressed === 'true' || outcome?.before?.pressed === 'true'))
    || String(control.className || '').includes('ss-facet-filter-label')
    || String(control.className || '').includes('bc-carousel__bullet-active')
    || control.tag === 'select'
    || (control.type === 'submit' && control.formInvalid)
    || Boolean(control.quantityAtMin)
  );
}
