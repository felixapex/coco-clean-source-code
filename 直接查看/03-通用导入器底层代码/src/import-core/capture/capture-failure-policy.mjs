function resourceUrls(message) {
  const detailsText = String(message || '').match(/details=(\{.*\})\s*$/s)?.[1];
  if (detailsText) {
    try {
      const details = JSON.parse(detailsText);
      const candidates = [
        ...(details?.pending || []),
        ...(details?.failed || []),
        ...(details?.pendingBackgrounds || []),
        ...(details?.failedBackgrounds || []),
        ...(details?.failedStylesheets || []),
        ...(details?.uncapturedStylesheets || []),
        ...(details?.failedFonts || []),
        ...(details?.uncapturedFonts || []),
      ];
      return [...new Set(candidates
        .map((candidate) => candidate?.src || candidate?.declaredSrc || candidate?.source || candidate?.url)
        .filter(Boolean)
        .map(String))];
    } catch {}
  }
  const match = String(message || '').match(/"(?:src|declaredSrc|source|url)":"(https?:\\?\/\\?\/[^"\\]+(?:\.[^"\\]*)*)"/i)?.[1]?.replaceAll('\\/', '/');
  return match ? [match] : [];
}

function firstResourceUrl(message) {
  return resourceUrls(message)[0] || null;
}

export function buildCaptureValidationDetails(result) {
  const readiness = result?.metadata?.visualReadiness || {};
  return {
    viewportWidth: readiness.viewportWidth ?? null,
    documentWidth: readiness.documentWidth ?? null,
    horizontalOverflowPx: readiness.horizontalOverflowPx ?? null,
    pending: readiness.pendingImageDetails ?? [],
    failed: readiness.failedImageDetails ?? [],
    pendingBackgrounds: readiness.pendingBackgroundImageDetails ?? [],
    failedBackgrounds: readiness.failedBackgroundImageDetails ?? [],
    failedStylesheets: readiness.failedStylesheetDetails ?? [],
    uncapturedStylesheets: readiness.uncapturedStylesheetDetails ?? [],
    failedFonts: readiness.failedFontDetails ?? [],
    uncapturedFonts: readiness.uncapturedFontDetails ?? [],
    failedNetworkRequests: readiness.failedNetworkRequestDetails ?? [],
  };
}

export function createInvalidCaptureError({ channel = 'source', route = '', failures = [], result } = {}) {
  const label = String(channel || 'source');
  return new Error(`Invalid ${label} capture for ${route}: ${(failures || []).join(', ')} details=${JSON.stringify(buildCaptureValidationDetails(result))}`);
}

export function classifyCapturePipelineFailure(error, { route = '', resourceUrl = '', validationFailures = [] } = {}) {
  const message = String(error?.message ?? error ?? 'unknown capture failure');
  const evidence = [...validationFailures, message].join(' ');
  const detectedResourceUrls = resourceUrls(message);
  if (/source-verification-challenge|just a moment|checking your browser|verify (?:that )?you are human/i.test(evidence)) {
    return { kind: 'source-protected', signature: 'source-protected:verification-challenge', route, message };
  }
  const criticalImage = message.match(/Critical image capture failed:\s*(https?:\/\/\S+?)(?:\.|\s)\s*Page-screenshot fallback is forbidden for navigation imagery/i);
  if (criticalImage) {
    return { kind: 'shared-resource', resourceUrl: criticalImage[1], signature: `shared-resource:${criticalImage[1]}`, route, message };
  }
  if (/uncaptured-fonts|failed-fonts/i.test(evidence)) {
    const fontUrl = resourceUrl || firstResourceUrl(message) || 'font://unknown';
    return { kind: 'shared-resource', resourceUrl: fontUrl, signature: `shared-resource:${fontUrl}`, route, message };
  }
  if (/uncaptured-stylesheets|failed-stylesheets|pending-stylesheets|external-stylesheet-not-frozen/i.test(evidence)) {
    const stylesheetUrl = resourceUrl || firstResourceUrl(message) || 'stylesheet://unknown';
    return { kind: 'shared-resource', resourceUrl: stylesheetUrl, signature: `shared-resource:${stylesheetUrl}`, route, message };
  }
  const failedResourceUrl = resourceUrl || firstResourceUrl(message);
  if (failedResourceUrl || /pending-images|pending-background-images|failed-images|failed-background-images|Unable to freeze document/i.test(evidence)) {
    return {
      kind: 'resource',
      resourceUrl: failedResourceUrl || null,
      resourceUrls: detectedResourceUrls,
      signature: failedResourceUrl ? `resource:${failedResourceUrl}` : `resource:${route || 'unknown'}`,
      route,
      message,
    };
  }
  const signatures = [
    [/ERR_CONNECTION_RESET/i, 'connection-reset'],
    [/ERR_NETWORK_ACCESS_DENIED/i, 'network-access-denied'],
    [/ERR_NETWORK_CHANGED/i, 'network-changed'],
    [/ERR_PROXY_CONNECTION_FAILED/i, 'proxy-connection-failed'],
    [/CDP command timeout:\s*Page\.navigate/i, 'page-navigation-command-timeout'],
    [/CDP command timeout:\s*Runtime\.evaluate/i, 'runtime-evaluate-command-timeout'],
    [/Timed out waiting for document\.readyState/i, 'document-ready-timeout'],
    [/Navigation timeout|navigation.*timed out|ETIMEDOUT|fetch failed/i, 'timeout'],
    [/Target closed|Session closed|WebSocket.*closed/i, 'browser-session-closed'],
  ];
  const network = signatures.find(([pattern]) => pattern.test(message));
  if (network) return { kind: 'infrastructure', signature: network[1], route, message };
  return { kind: 'page', signature: `page:${route || 'unknown'}`, route, message };
}
