import { resolveAndValidateUrl, validateUrlSyntax } from './url-policy.mjs';

function normalizeEntry(params, verdict) {
  return {
    requestId: params.requestId,
    url: params.request?.url ?? null,
    method: params.request?.method ?? null,
    resourceType: params.resourceType ?? null,
    ...verdict,
  };
}

export async function installBrowserRequestGuard(client, options = {}) {
  if (!client?.send || !client?.onEvent) throw new Error('CDP client with send() and onEvent() is required');
  const stats = { allowed: [], blocked: [] };
  const resolver = options.resolver;
  const onBlocked = options.onBlocked;
  const onAllowed = options.onAllowed;
  const pending = new Set();
  let eventRevision = 0;

  await client.send('Fetch.enable', {
    patterns: [
      { urlPattern: 'http://*', requestStage: 'Request' },
      { urlPattern: 'https://*', requestStage: 'Request' },
      { urlPattern: 'file://*', requestStage: 'Request' },
    ],
  });

  const off = client.onEvent('Fetch.requestPaused', (params) => {
    eventRevision += 1;
    const work = (async () => {
      const requestId = params.requestId;
      const rawUrl = params.request?.url ?? '';
      try {
        // Syntax check is done first so unsupported schemes / URL credentials fail before DNS.
        validateUrlSyntax(rawUrl);
        await resolveAndValidateUrl(rawUrl, { resolver });
        const entry = normalizeEntry(params, { decision: 'allow' });
        stats.allowed.push(entry);
        await onAllowed?.(entry);
        await client.send('Fetch.continueRequest', { requestId });
      } catch (error) {
        const entry = normalizeEntry(params, {
          decision: 'block',
          reason: String(error?.message ?? error),
        });
        stats.blocked.push(entry);
        await onBlocked?.(entry);
        await client.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      }
    })();
    pending.add(work);
    work.finally(() => pending.delete(work));
    return work;
  });

  return {
    stats,
    async drain() {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const observedRevision = eventRevision;
        await Promise.allSettled([...pending]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (pending.size === 0 && eventRevision === observedRevision) return;
      }
      await Promise.allSettled([...pending]);
    },
    async close() {
      off?.();
      await Promise.allSettled([...pending]);
      await client.send('Fetch.disable');
    },
  };
}
