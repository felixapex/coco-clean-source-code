import { createHash } from 'node:crypto';

const BOUNDARY_PATTERN = /(?:checkout|payment|pay\s*now|sign[ -]?in|log[ -]?in|account|personal|register|place\s+order)/i;

export function partitionInteractionRoutes(routes = [], workerCount = 8) {
  const count = Math.max(1, Math.min(12, Math.floor(Number(workerCount) || 1), routes.length || 1));
  const shards = Array.from({ length: count }, () => []);
  routes.forEach((route, index) => shards[index % count].push(route));
  return shards.filter((shard) => shard.length > 0);
}

export function resolveInteractionWorkerCount({ platform = '', configured = 8 } = {}) {
  if (String(platform).toLowerCase() === 'external') return 1;
  return Math.max(1, Math.min(12, Math.floor(Number(configured) || 1)));
}

export function interactionLoadPhases(purpose = 'inventory') {
  return purpose === 'control-reset'
    ? ['page-load', 'content-ready']
    : ['page-load', 'page-stabilize', 'content-ready'];
}

export function mergeInteractionReports(reports = [], expectedRoutes = []) {
  const routeResults = reports.flatMap((report) => report.routeResults || []);
  const failures = reports.flatMap((report) => report.failures || []);
  const auditedRoutes = new Set(routeResults.map((result) => result.route));
  for (const route of expectedRoutes) {
    if (!auditedRoutes.has(route)) failures.push({ route, type: 'missing-route-audit' });
  }
  return {
    routeCount: expectedRoutes.length,
    comparedControlCount: reports.reduce((sum, report) => sum + Number(report.comparedControlCount || 0), 0),
    sourceControlCount: reports.reduce((sum, report) => sum + Number(report.sourceControlCount || 0), 0),
    localControlCount: reports.reduce((sum, report) => sum + Number(report.localControlCount || 0), 0),
    routeResults,
    failures,
    pass: routeResults.length === expectedRoutes.length && failures.length === 0,
  };
}

export function isInteractionPageReady({ readyState, bodyTextLength } = {}) {
  return readyState !== 'loading' && Number(bodyTextLength || 0) > 0;
}

export function isInteractionContentReady({ bodyTextLength, controlCount, commercePresent, productCount } = {}) {
  if (Number(bodyTextLength || 0) <= 0 || Number(controlCount || 0) <= 0) return false;
  return !commercePresent || Number(productCount || 0) > 0;
}

export function interactionControlPreparationScrollY(control = {}, viewportHeight = 0) {
  const documentY = Math.max(0, Number(control.documentY || 0));
  const halfViewport = Math.max(0, Number(viewportHeight || 0) / 2);
  return Math.max(0, Math.round(documentY - halfViewport));
}

export function interactionControlPreparationScrollCandidates(control = {}, viewportHeight = 0, currentDocumentHeight = 0) {
  const viewport = Math.max(0, Number(viewportHeight || 0));
  const currentHeight = Math.max(viewport, Number(currentDocumentHeight || 0));
  const capturedHeight = Math.max(0, Number(control.documentHeight || 0));
  const capturedY = Math.max(0, Number(control.documentY || 0));
  const direct = interactionControlPreparationScrollY(control, viewport);
  const proportional = capturedHeight > 0
    ? Math.max(0, Math.round((capturedY / capturedHeight) * currentHeight - viewport / 2))
    : direct;
  const pageEnd = Math.max(0, Math.round(currentHeight - viewport));
  return [...new Set([direct, proportional, pageEnd])];
}

function normalizedText(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizedPath(value = '') {
  if (!value) return '';
  try {
    const url = new URL(value, 'https://matbox.invalid');
    for (const parameter of ['matbox-viewport', 'full-site-audit', 'responsive-audit']) url.searchParams.delete(parameter);
    for (const parameter of [...url.searchParams.keys()]) {
      if (/^__cf_/i.test(parameter) || /^_(?:gl$|gcl_|ga(?:_|$))/i.test(parameter)) url.searchParams.delete(parameter);
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const query = url.searchParams.toString();
    return `${path}${query ? `?${query}` : ''}${url.hash}`;
  } catch {
    return normalizedText(value);
  }
}

function canonicalAbsoluteTarget(value = '') {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${path}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

function externalAuthRedirectTarget(value = '') {
  try {
    const url = new URL(value);
    for (const parameter of ['next', 'redirect', 'redirect_uri', 'continue']) {
      const candidate = url.searchParams.get(parameter);
      if (!candidate) continue;
      const target = new URL(candidate, url.origin);
      if (target.origin === url.origin) return canonicalAbsoluteTarget(target.href);
    }
  } catch {}
  return '';
}

export function classifyControl(control = {}) {
  const tag = normalizedText(control.tag);
  const role = normalizedText(control.role);
  const type = normalizedText(control.type);
  const boundaryText = `${control.text || ''} ${control.ariaLabel || ''} ${control.href || ''} ${control.formAction || ''}`;
  if (normalizedText(control.slideout)) return 'safe-click';
  if (type === 'submit' && BOUNDARY_PATTERN.test(boundaryText)) return 'boundary-only';
  if (tag === 'a' && control.href) return 'navigation';
  if (tag === 'button' || tag === 'summary' || role === 'button' || ['button', 'submit'].includes(type)) {
    return BOUNDARY_PATTERN.test(boundaryText) ? 'boundary-only' : 'safe-click';
  }
  if (tag === 'select' || ['checkbox', 'radio', 'range'].includes(type)) return 'safe-click';
  return 'unclassified';
}

export function inferInteractionEffect({ before = {}, after = {} } = {}) {
  if (after.url && before.url && normalizedPath(after.url) !== normalizedPath(before.url)) return 'navigation';
  if (Number(after.visiblePanels || 0) > Number(before.visiblePanels || 0)) {
    return normalizedText(after.surfaceKind) || 'panel';
  }
  if (Number(after.openDetails || 0) > Number(before.openDetails || 0)) return 'accordion';
  if (after.selectionChanged) return 'selection';
  if (after.valueChanged) return 'value-change';
  return 'no-op';
}

export function interactionRunPlan({ route = '/', controls = [] } = {}) {
  return controls.map((control) => ({
    route,
    fingerprint: control.fingerprint,
    occurrence: Number(control.occurrence || 0),
    resetBefore: true,
  }));
}

export function selectInteractionControls(controls = [], fingerprints = []) {
  const requested = new Set(fingerprints.filter(Boolean));
  if (!requested.size) return controls;
  return controls.filter((control) => requested.has(control.fingerprint));
}

export async function executeInteractionPlan({
  runs = [], executeRun, timeoutMs = 15000, maxAttempts = 1,
  shouldRetry = () => false, onAttemptFailure, onTimeout, onProgress, onResult,
} = {}) {
  if (typeof executeRun !== 'function') throw new TypeError('executeRun is required');
  const results = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    let result;
    let resultTimedOut = false;
    const attemptLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      let timer;
      let execution;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`control-timeout:${timeoutMs}ms`)), timeoutMs);
        });
        execution = Promise.resolve().then(() => executeRun(run));
        const value = await Promise.race([execution, timeout]);
        result = { run, ok: true, value };
        resultTimedOut = false;
      } catch (error) {
        const message = String(error?.message || error);
        const timedOut = /control-timeout/i.test(message);
        if (timedOut) {
          await onTimeout?.({ run, error: message, attempt, maxAttempts: attemptLimit });
          await execution?.catch(() => {});
        }
        result = { run, ok: false, error: message };
        resultTimedOut = timedOut;
        if (attempt < attemptLimit && shouldRetry(message, run)) {
          if (!timedOut) await onAttemptFailure?.({ run, error: message, attempt, maxAttempts: attemptLimit });
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
      break;
    }
    results.push(result);
    onProgress?.({ completed: index + 1, total: runs.length, ok: result.ok, run, error: result.error || '' });
    await onResult?.({ completed: index + 1, total: runs.length, ok: result.ok, run, error: result.error || '', result, timedOut: resultTimedOut });
  }
  return results;
}

export function controlFingerprint(control = {}) {
  const identity = [
    normalizedText(control.tag),
    normalizedText(control.role),
    normalizedText(control.type),
    normalizedText(control.ariaLabel),
    normalizedText(control.text),
    normalizedText(control.name),
    normalizedPath(control.href),
    Number(control.occurrence || 0),
  ].join('|');
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function normalizeEffect(effect = {}) {
  const normalized = { ...effect };
  // Scroll locking is an implementation detail. The visible panel and
  // post-click visual gates verify what the user actually sees.
  delete normalized.bodyOverflow;
  if (normalized.surface && typeof normalized.surface === 'object') {
    normalized.surface = { ...normalized.surface };
    delete normalized.surface.rect;
  }
  if (typeof normalized.path === 'string') normalized.path = normalizedPath(normalized.path);
  if (typeof normalized.urlBefore === 'string') normalized.urlBefore = normalizedPath(normalized.urlBefore);
  if (typeof normalized.urlAfter === 'string') normalized.urlAfter = normalizedPath(normalized.urlAfter);
  if ('visiblePanelsDelta' in normalized) normalized.visiblePanelsDelta = Math.sign(Number(normalized.visiblePanelsDelta || 0));
  if ('openDetailsDelta' in normalized) normalized.openDetailsDelta = Math.sign(Number(normalized.openDetailsDelta || 0));
  if (normalized.selectionChanged || Number(normalized.visiblePanelsDelta || 0) !== 0 || Number(normalized.openDetailsDelta || 0) !== 0) {
    delete normalized.expanded;
    delete normalized.pressed;
    delete normalized.checked;
  }
  if (Number(normalized.visiblePanelsDelta || 0) !== 0) {
    delete normalized.surface;
    if (!normalized.selectionChanged) delete normalized.selectionChanged;
    if (!normalized.valueChanged) delete normalized.valueChanged;
  }
  delete normalized.syntheticInteractionContract;
  return normalized;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function compareInteractionInventories({ source = [], local = [], sourceOrigin = '', interactionRedirects = {} } = {}) {
  const failures = [];
  const localByFingerprint = new Map(local.map((control) => [control.fingerprint, control]));
  const sourceByFingerprint = new Map(source.map((control) => [control.fingerprint, control]));
  let comparedCount = 0;

  for (const sourceControl of source) {
    if (sourceControl.classification === 'unclassified') {
      failures.push({ type: 'unclassified-control', fingerprint: sourceControl.fingerprint, side: 'source', sourceControl });
    }
    const localControl = localByFingerprint.get(sourceControl.fingerprint);
    if (!localControl) {
      failures.push({ type: 'missing-local-control', fingerprint: sourceControl.fingerprint, sourceControl });
      continue;
    }
    comparedCount += 1;
    if (localControl.classification === 'unclassified') {
      failures.push({ type: 'unclassified-control', fingerprint: localControl.fingerprint, side: 'local', localControl });
    }
    if (
      sourceControl.classification === 'navigation'
      && typeof localControl.effect?.path === 'string'
      && sourceOrigin
      && localControl.effect.path.startsWith(sourceOrigin)
    ) {
      failures.push({ type: 'source-origin-escape', fingerprint: sourceControl.fingerprint, path: localControl.effect.path });
    }
    const sourceEffectType = sourceControl.effect?.effectType;
    const localEffectType = localControl.effect?.effectType;
    const declaredRedirect = interactionRedirects[sourceControl.href]
      || interactionRedirects[normalizedPath(sourceControl.href)];
    const declaredRedirectEquivalent = Boolean(declaredRedirect)
      && sourceEffectType === 'navigation'
      && localEffectType === 'navigation'
      && normalizedPath(localControl.effect?.path || localControl.effect?.urlAfter) === normalizedPath(declaredRedirect);
    if (declaredRedirectEquivalent) continue;
    const sourceNavigationTarget = sourceControl.effect?.path || sourceControl.effect?.urlAfter;
    const localNavigationTarget = localControl.effect?.path || localControl.effect?.urlAfter;
    const externalAuthRedirectEquivalent = sourceEffectType === 'navigation'
      && localEffectType === 'navigation'
      && (
        externalAuthRedirectTarget(sourceNavigationTarget) === canonicalAbsoluteTarget(localNavigationTarget)
        || externalAuthRedirectTarget(localNavigationTarget) === canonicalAbsoluteTarget(sourceNavigationTarget)
      )
      && Boolean(externalAuthRedirectTarget(sourceNavigationTarget) || externalAuthRedirectTarget(localNavigationTarget));
    if (externalAuthRedirectEquivalent) continue;
    const calendlyFallbackEquivalent = Boolean(sourceControl.calendlyBound && localControl.calendlyBound)
      && new Set([sourceEffectType, localEffectType]).size === 2
      && [sourceEffectType, localEffectType].every((type) => type === 'modal' || type === 'navigation');
    if (sourceEffectType && localEffectType && sourceEffectType !== localEffectType) {
      if (calendlyFallbackEquivalent) continue;
      failures.push({
        type: 'effect-type-mismatch',
        fingerprint: sourceControl.fingerprint,
        sourceEffectType,
        localEffectType,
        sourceControl,
        localControl,
      });
      continue;
    }
    if (stableJson(normalizeEffect(sourceControl.effect)) !== stableJson(normalizeEffect(localControl.effect))) {
      failures.push({
        type: 'effect-mismatch',
        fingerprint: sourceControl.fingerprint,
        sourceControl,
        localControl,
        sourceEffect: sourceControl.effect,
        localEffect: localControl.effect,
      });
    }
  }

  for (const localControl of local) {
    if (!sourceByFingerprint.has(localControl.fingerprint)) {
      failures.push({ type: 'unexpected-local-control', fingerprint: localControl.fingerprint, localControl });
    }
  }

  return { pass: failures.length === 0, comparedCount, failures };
}
