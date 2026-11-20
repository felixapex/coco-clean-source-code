import { createHash } from 'node:crypto';

const REVERSIBLE_EFFECTS = new Set([
  'modal', 'drawer', 'mega-menu', 'panel', 'accordion', 'tooltip', 'no-op',
]);
const RELOAD_EFFECTS = new Set(['selection', 'value-change']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function chooseInteractionIsolation({ control = {}, effect = {} } = {}) {
  if (control.classification === 'boundary-only' || effect.serverMutation) return 'server-fixture';
  if (effect.storageChanged || effect.cookieChanged || effect.sessionChanged) return 'new-context';
  if (control.classification === 'navigation' || effect.effectType === 'navigation') {
    return effect.target === 'new-tab' ? 'verified-restore' : 'history-restore';
  }
  if (RELOAD_EFFECTS.has(effect.effectType)) return 'reload';
  if (control.classification === 'safe-click' && REVERSIBLE_EFFECTS.has(effect.effectType)) return 'verified-restore';
  return 'new-context';
}

export function interactionStateSignature(state = {}) {
  const comparable = {
    url: String(state.url || ''),
    historyLength: Number(state.historyLength || 0),
    visiblePanels: Number(state.visiblePanels || 0),
    openDetails: Number(state.openDetails || 0),
    selectedState: String(state.selectedState || ''),
    localStorageDigest: String(state.localStorageDigest || ''),
    sessionStorageDigest: String(state.sessionStorageDigest || ''),
    cookieDigest: String(state.cookieDigest || ''),
    popupCount: Number(state.popupCount || 0),
    mutationRequestCount: Number(state.mutationRequestCount || 0),
  };
  return createHash('sha256').update(stableJson(comparable)).digest('hex');
}

export function isInteractionStateRestored(before = {}, after = {}) {
  return interactionStateSignature(before) === interactionStateSignature(after);
}

export function createInteractionSession({ pageReady = false } = {}) {
  return {
    pageReady: Boolean(pageReady),
    nextReset: pageReady ? 'none' : 'reload',
  };
}

export function advanceInteractionSession(session = {}, {
  isolation,
  restored = false,
} = {}) {
  if ((isolation === 'verified-restore' || isolation === 'history-restore') && restored) {
    return { ...session, pageReady: true, nextReset: 'none' };
  }
  if (isolation === 'history-restore') {
    return { ...session, pageReady: false, nextReset: 'new-page' };
  }
  if (isolation === 'verified-restore' || isolation === 'reload') {
    return { ...session, pageReady: false, nextReset: 'reload' };
  }
  if (isolation === 'new-page' || isolation === 'new-context' || isolation === 'server-fixture') {
    return { ...session, pageReady: false, nextReset: isolation };
  }
  return { ...session, pageReady: false, nextReset: 'new-context' };
}
