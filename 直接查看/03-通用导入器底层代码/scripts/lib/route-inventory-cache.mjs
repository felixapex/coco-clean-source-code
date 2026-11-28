function normalizeCached(cached, sourceOrigin) {
  const routes = Array.isArray(cached?.routes) ? cached.routes : [];
  let cachedOrigin = null;
  try { cachedOrigin = new URL(cached?.source).origin; } catch {}
  if (cachedOrigin !== sourceOrigin || routes.length === 0 || Number(cached?.routeCount) !== routes.length) return null;
  return {
    root: cached.source,
    sitemapUrls: Array.from({ length: Number(cached.sitemapCount) || 0 }),
    linkedRouteCount: Number(cached.homepageLinkCount) || 0,
    routes,
  };
}

export async function resolveRouteInventory({ sourceOrigin, discover, readCached, preferCached = false }) {
  if (preferCached) {
    let cached;
    try { cached = await readCached(); } catch {}
    const inventory = normalizeCached(cached, sourceOrigin);
    if (inventory) return { inventory, reused: true, warning: null };
  }
  try {
    return { inventory: await discover(), reused: false, warning: null };
  } catch (error) {
    let cached;
    try { cached = await readCached(); } catch {}
    const inventory = normalizeCached(cached, sourceOrigin);
    if (!inventory) throw error;
    return {
      inventory,
      reused: true,
      warning: String(error?.stack || error),
    };
  }
}
