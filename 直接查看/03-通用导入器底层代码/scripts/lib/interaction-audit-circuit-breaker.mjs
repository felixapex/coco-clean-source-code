const sharedFailureTypes = new Set([
  'no-observable-effect',
  'ungenerated-internal-target',
  'source-domain-escape',
  'external-navigation-target',
  'invalid-internal-target',
]);

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function interactionFailureSignature(failure = {}) {
  if (!sharedFailureTypes.has(failure.type)) return null;
  if (failure.target) return `${failure.type}|${normalizedText(failure.target)}`;
  const control = failure.control || {};
  const classes = Array.isArray(control.classes)
    ? control.classes
    : String(control.className || control.classes || '').split(/\s+/).filter(Boolean);
  return [
    failure.type,
    normalizedText(control.tag || control.tagName || ''),
    [...classes].sort().join('.'),
    normalizedText(control.text || control.label || ''),
  ].join('|');
}

export function recordInteractionFailures(previousState, failures = [], { threshold = 3 } = {}) {
  const state = previousState || { signatures: {}, tripped: false, trigger: null };
  if (state.tripped) return state;
  for (const failure of failures) {
    const signature = interactionFailureSignature(failure);
    if (!signature) continue;
    const route = String(failure.route || '');
    const routes = new Set(state.signatures[signature] || []);
    if (route) routes.add(route);
    state.signatures[signature] = [...routes];
    if (routes.size >= threshold) {
      state.tripped = true;
      state.trigger = {
        signature,
        routeCount: routes.size,
        routes: [...routes],
        threshold,
      };
      break;
    }
  }
  return state;
}
